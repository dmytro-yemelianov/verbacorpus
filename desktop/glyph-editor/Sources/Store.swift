import Foundation
import CoreFoundation
import AppKit
import CryptoKit
import Darwin

enum EditorError: Error, LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}
func fail(_ message: String) -> EditorError { .message(message) }
func object(_ data: Data) throws -> [String: Any] {
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw fail("Очікувався JSON-об’єкт") }
    return value
}
func jsonData(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]) }
final class EditorStore {
    let corpus: URL
    let project: URL
    let catalog: [String: Any]
    let fonts: [[String: Any]]
    let byID: [String: [String: Any]]
    let snapshot: String
    private lazy var candidateJobs = CandidateJobs(corpus:corpus,project:project)
    private let lockHandle: FileHandle
    private let clipboardName = NSPasteboard.Name("org.verbacorpus.glyph-test." + UUID().uuidString)
    init(corpus: URL, project: URL?) throws {
        self.corpus = corpus.standardizedFileURL.resolvingSymlinksInPath()
        catalog = try object(Data(contentsOf: self.corpus.appendingPathComponent("font-corpus/catalog.json")))
        guard catalog["schemaVersion"] as? String == "2.0.0", let snapshot = catalog["snapshot"] as? String,
              let fonts = catalog["fonts"] as? [[String: Any]], !fonts.isEmpty,
              snapshot.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil,
              fonts.allSatisfy({ ($0["id"] as? String)?.range(of:"^[a-z0-9][a-z0-9._-]{0,159}$",options:.regularExpression) != nil }),
              Set(fonts.compactMap { $0["id"] as? String }).count == fonts.count else { throw fail("Потрібен корпус Para Font Interchange 2.0") }
        self.snapshot = snapshot; self.fonts = fonts
        byID = Dictionary(uniqueKeysWithValues: fonts.compactMap { f in (f["id"] as? String).map { ($0, f) } })
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        self.project = (project ?? support.appendingPathComponent("VerbaGlyphEditor/Projects/" + snapshot)).standardizedFileURL.resolvingSymlinksInPath()
        if self.project.path == self.corpus.path || self.project.path.hasPrefix(self.corpus.path + "/") { throw fail("Папка правок має бути поза джерельним корпусом") }
        try FileManager.default.createDirectory(at: self.project.appendingPathComponent("fonts"), withIntermediateDirectories: true)
        let lockURL = self.project.appendingPathComponent(".editor.lock")
        if !FileManager.default.fileExists(atPath: lockURL.path) { FileManager.default.createFile(atPath: lockURL.path, contents: Data(), attributes: [.posixPermissions: 0o600]) }
        let lock = try FileHandle(forUpdating: lockURL)
        guard flock(lock.fileDescriptor, LOCK_EX | LOCK_NB) == 0 else { try? lock.close(); throw fail("Цей проєкт уже відкрито в іншому вікні редактора") }
        self.lockHandle = lock
    }
    deinit { _ = flock(lockHandle.fileDescriptor, LOCK_UN); try? lockHandle.close() }
    func summary(_ id: String) throws -> [String: Any] {
        guard let font = byID[id] else { throw fail("Невідомий шрифт: " + id) }; return font
    }
    func stateURL(_ id: String) throws -> URL { _ = try summary(id); return project.appendingPathComponent("fonts/" + id + ".json") }
    func validate(_ state: [String: Any], id: String) throws {
        let font = try summary(id)
        guard state["format"] as? String == "para-glyph-edits", state["schemaVersion"] as? Int == 1,
              state["fontId"] as? String == id, state["snapshot"] as? String == snapshot,
              state["baseSha256"] as? String == font["sha256"] as? String,
              let revision = state["revision"] as? Int, revision >= 0,
              let edits = state["edits"] as? [String: Any], edits.count <= 65536,
              let reviewed = state["reviewed"] as? [String], reviewed.count <= 65536 else {
            throw fail("Правки належать іншій версії шрифту або мають невірний формат")
        }
        if let raw = state["fontGuides"] {
            let keys: Set<String> = ["baseline", "capHeight", "xHeight", "ascent", "descent", "lineGap"]
            guard let guides = raw as? [String: Any], guides.keys.allSatisfy({ keys.contains($0) }) else { throw fail("Некоректні гайди шрифту") }
            for (key, value) in guides {
                guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                      number.doubleValue.isFinite, abs(number.doubleValue) <= 16384,
                      key == "baseline" || number.doubleValue >= 0 else { throw fail("Некоректні гайди шрифту") }
            }
        }
        if let raw = state["fontCell"] {
            guard let cell = raw as? [String:Any], Set(cell.keys) == Set(["width","height","advanceX","baseline"]) else { throw fail("Некоректна комірка шрифту") }
            for value in cell.values {
                guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite, n.doubleValue.rounded() == n.doubleValue else { throw fail("Некоректна комірка шрифту") }
            }
            guard let w = cell["width"] as? Int, let h = cell["height"] as? Int, let a = cell["advanceX"] as? Int, let b = cell["baseline"] as? Int,
                  w > 0, h > 0, w <= 1024, h <= 1024, w*h <= 262144, a > 0, a <= 4096, b >= 0, b <= h else { throw fail("Некоректна комірка шрифту") }
        }
        for (key, value) in edits {
            guard key.range(of: "^g[0-9]{6}$", options: .regularExpression) != nil,
                  let glyph = value as? [String: Any], glyph["id"] as? String == key,
                  let w = glyph["width"] as? Int, let h = glyph["height"] as? Int,
                  w >= 0, h >= 0, w <= 1024, h <= 1024, w*h <= 262144,
                  let rows = glyph["rows"] as? [String], rows.count == h,
                  glyph["rowBytes"] as? Int == (w+7)/8,
                  rows.allSatisfy({ $0.count == ((w+7)/8)*2 && $0.range(of: "^[0-9A-Fa-f]*$", options: .regularExpression) != nil }) else { throw fail("Некоректний растр гліфа " + key) }
        }
    }
    func readState(_ id: String) throws -> Any {
        let url = try stateURL(id)
        if !FileManager.default.fileExists(atPath: url.path) { return NSNull() }
        let state = try object(Data(contentsOf: url)); try validate(state, id: id); return state
    }
    func saveState(_ id: String, state: [String: Any]) throws -> [String: Any] {
        try validate(state, id: id)
        let url = try stateURL(id)
        if let existing = try readState(id) as? [String: Any],
           (existing["revision"] as? Int ?? 0) > (state["revision"] as? Int ?? 0) { throw fail("Новіші правки вже збережено. Перезавантажте шрифт.") }
        let data = try jsonData(state); if data.count > 16*1024*1024 { throw fail("Завеликий набір правок") }
        try data.write(to: url, options: .atomic)
        return ["revision": state["revision"]!, "path": url.path]
    }
    private func referenceCounts() -> [String:Any] {
        guard let data = try? object(Data(contentsOf:project.appendingPathComponent("reference-coverage.json"))),
              data["snapshot"] as? String == snapshot else { return [:] }
        return data["fonts"] as? [String:Any] ?? [:]
    }
    private func progress(_ state: [String:Any], id:String) throws -> [String:Any] {
        let guides = (state["fontGuides"] as? [String:Any])?.isEmpty == false ? 1 : 0
        var present:Int, inferredReferences:[String:Any]?
        if let coverage = state["ukrainianCoverage"] as? [String:Any],
           coverage["checkedRevision"] as? Int == state["revision"] as? Int,
           let actual = coverage["present"] as? Int, (0...66).contains(actual) { present = actual }
        else {
            // Older drafts predate coverage metadata. Count effective labels and
            // ink once, rather than displaying the unedited source's coverage.
            guard let path = try summary(id)["url"] as? String else { throw fail("Немає ресурсу шрифту") }
            let source = try object(Data(asset(path).utf8))
            let edits = state["edits"] as? [String:[String:Any]] ?? [:]
            let glyphs = ((source["glyphs"] as? [[String:Any]]) ?? []).filter { edits[$0["id"] as? String ?? ""] == nil } + Array(edits.values)
            var chars:Set<String> = []
            for glyph in glyphs {
                guard let rows = glyph["rows"] as? [String], rows.contains(where:{$0.contains(where:{"123456789abcdefABCDEF".contains($0)})}) else { continue }
                for label in glyph["labels"] as? [[String:Any]] ?? [] where label["kind"] as? String == "unicode" {
                    if let value = label["value"] as? String { chars.insert(value) }
                }
            }
            present = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя".filter { chars.contains(String($0)) }.count
            inferredReferences = ["upper":"ABCDEFGHIJKLMNOPQRSTUVWXYZ".filter { chars.contains(String($0)) }.count,
                                  "lower":"abcdefghijklmnopqrstuvwxyz".filter { chars.contains(String($0)) }.count]
        }
        var result: [String:Any] = ["edits":((state["edits"] as? [String:Any])?.count ?? 0) + guides + (state["fontCell"] == nil ? 0 : 1),
                                   "reviewed":(state["reviewed"] as? [String])?.count ?? 0,
                                   "done":state["done"] as? Bool ?? false, "ukrainianPresent":present]
        if let refs = state["latinReferences"] as? [String:Any], refs["checkedRevision"] as? Int == state["revision"] as? Int {
            result["latinReferences"] = refs
        } else { result["latinReferences"] = inferredReferences }
        return result
    }
    func projectSummary() -> ([String: Any], [String]) {
        var summaries: [String: Any] = [:], errors: [String] = [], entries:[String:Any] = [:]
        let cacheURL = project.appendingPathComponent(".summary-cache.json")
        let cache = (try? object(Data(contentsOf:cacheURL))) ?? [:]
        let previous = cache["snapshot"] as? String == snapshot && cache["schemaVersion"] as? Int == 2
            ? (cache["entries"] as? [String:Any] ?? [:]) : [:]
        let references = referenceCounts()
        let urls = (try? FileManager.default.contentsOfDirectory(at: project.appendingPathComponent("fonts"), includingPropertiesForKeys: nil)) ?? []
        for url in urls where url.pathExtension == "json" {
            let id = url.deletingPathExtension().lastPathComponent
            do {
                _ = try summary(id)
                let attrs = try FileManager.default.attributesOfItem(atPath:url.path)
                guard let size = attrs[.size] as? NSNumber, let modified = attrs[.modificationDate] as? Date,
                      let inode = attrs[.systemFileNumber] as? NSNumber else { throw fail("Не вдалося прочитати атрибути файлу правок") }
                let fingerprint:[String:Any] = ["size":size, "modified":modified.timeIntervalSince1970, "inode":inode]
                var item:[String:Any]
                if let old = previous[id] as? [String:Any], let stamp = old["fingerprint"] as? [String:Any],
                   NSDictionary(dictionary:stamp).isEqual(to:fingerprint), let cached = old["summary"] as? [String:Any],
                   cached["edits"] is Int, cached["reviewed"] is Int, cached["done"] is Bool, cached["ukrainianPresent"] is Int {
                    item = cached
                } else {
                    guard let state = try readState(id) as? [String:Any] else { continue }
                    item = try progress(state,id:id)
                }
                entries[id] = ["fingerprint":fingerprint,"summary":item]
                // Source reference coverage is snapshot-scoped and is not part
                // of the draft fingerprint cache, so mapping updates stay live.
                if item["latinReferences"] == nil { item["latinReferences"] = references[id] }
                summaries[id] = item
            } catch { errors.append(id + ": " + error.localizedDescription) }
        }
        // This is disposable metadata. A failed cache write cannot fail startup
        // or a draft save; changed/replaced/deleted files are checked next time.
        if !NSDictionary(dictionary:previous).isEqual(to:entries),
           let data = try? jsonData(["schemaVersion":2,"snapshot":snapshot,"entries":entries]) {
            try? data.write(to:cacheURL,options:.atomic)
        }
        return (summaries, errors)
    }
    func bootstrap() -> [String: Any] {
        let (progress, errors) = projectSummary()
        let references = referenceCounts()
        let light = fonts.map { font -> [String: Any] in
            var item: [String: Any] = [:]
            for key in ["id", "name", "family", "cell", "coverage", "collection", "licenseId"] { item[key] = font[key] }
            item["latinReferences"] = references[font["id"] as? String ?? ""]
            return item
        }
        return ["snapshot": snapshot, "counts": catalog["counts"] ?? [:], "fonts": light,
                "progress": progress, "projectPath": project.path, "corpusPath": corpus.path, "warnings": errors]
    }
    func asset(_ path: String) throws -> String {
        let prefix = "/para/corpus/" + snapshot + "/"
        guard path.hasPrefix(prefix), !path.contains(".."), path.range(of: "^[a-zA-Z0-9/._-]+$", options: .regularExpression) != nil else { throw fail("Недозволений шлях ресурсу") }
        let relative = String(path.dropFirst(prefix.count))
        guard ["fonts/", "meta/", "glyphs/"].contains(where: { relative.hasPrefix($0) }), path.hasSuffix(".json") else { throw fail("Невідомий ресурс") }
        let root = corpus.appendingPathComponent("public").resolvingSymlinksInPath()
        let url = root.appendingPathComponent(String(path.dropFirst())).resolvingSymlinksInPath()
        guard url.path.hasPrefix(root.path + "/") else { throw fail("Ресурс поза корпусом") }
        let data = try Data(contentsOf: url)
        guard data.count <= 8*1024*1024, let text = String(data: data, encoding: .utf8) else { throw fail("Некоректний ресурс") }
        return text
    }
    func exportFont(_ id: String, document: [String: Any]) throws -> [String: Any] {
        let source = try summary(id)
        let raw = try asset(source["url"] as! String)
        let actual = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
        guard actual == source["sha256"] as? String else { throw fail("Джерельний шрифт змінився на диску") }
        guard document["format"] as? String == "para-font", document["schemaVersion"] as? String == "2.0.0",
              document["kind"] as? String == "derived", let exportID = document["id"] as? String,
              exportID.range(of: "^[a-z0-9][a-z0-9._-]{0,159}$", options: .regularExpression) != nil,
              let glyphs = document["glyphs"] as? [[String: Any]], !glyphs.isEmpty,
              document["license"] != nil, document["source"] != nil else { throw fail("Некоректний експорт шрифту") }
        let directory = project.appendingPathComponent("exports"); try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let filename = exportID + "-" + UUID().uuidString.prefix(8) + ".json", url = directory.appendingPathComponent(filename)
        try jsonData(document).write(to: url, options: .atomic)
        return ["path": url.path]
    }
    func clipboard(_ action: String, _ text: String?) throws -> Any {
        let access = { () throws -> Any in
            let board = CommandLine.arguments.contains("--isolated-clipboard") ? NSPasteboard(name: self.clipboardName) : NSPasteboard.general
            if action == "writeClipboard" {
                guard let text = text, text.utf8.count <= 512*1024 else { throw fail("Завелике виділення для буфера") }
                board.clearContents()
                guard board.setString(text, forType: .string) else { throw fail("Не вдалося записати буфер обміну") }
                return true
            }
            guard let text = board.string(forType: .string) else { return NSNull() }
            guard text.utf8.count <= 512*1024 else { throw fail("Завеликий вміст буфера обміну") }
            return text
        }
        return try Thread.isMainThread ? access() : DispatchQueue.main.sync(execute: access)
    }
    func command(_ action: String, _ args: [String: Any]) throws -> Any {
        switch action {
        case "referenceImport": return try candidateJobs.importReference(args)
        case "candidateStart":
            guard let request = args["request"] as? [String: Any], request["snapshot"] as? String == snapshot,
                  let requestedFont = request["font"] as? [String: Any], let id = requestedFont["id"] as? String,
                  requestedFont["sha256"] as? String == (try summary(id))["sha256"] as? String else { throw fail("Запит належить іншому шрифту або знімку") }
            return try candidateJobs.start(request)
        case "candidateStatus": return try candidateJobs.status(args["id"] as? String ?? "")
        case "candidateCancel": return try candidateJobs.cancel(args["id"] as? String ?? "")
        case "readClipboard", "writeClipboard": return try clipboard(action, args["text"] as? String)
        case "uiReady": return true
        case "bootstrap": return bootstrap()
        case "summary": return try summary(args["id"] as? String ?? "")
        case "readAsset": return try asset(args["path"] as? String ?? "")
        case "readState": return try readState(args["id"] as? String ?? "")
        case "saveState": return try saveState(args["id"] as? String ?? "", state: args["state"] as? [String: Any] ?? [:])
        case "exportFont": return try exportFont(args["id"] as? String ?? "", document: args["document"] as? [String: Any] ?? [:])
        case "readSession":
            let url = project.appendingPathComponent("session.json")
            return FileManager.default.fileExists(atPath: url.path) ? try object(Data(contentsOf: url)) : [:]
        case "saveSession":
            let data = try jsonData(args); if data.count > 65536 { throw fail("Завеликий стан сеансу") }
            try data.write(to: project.appendingPathComponent("session.json"), options: .atomic); return true
        default: throw fail("Невідома команда: " + action)
        }
    }
}
