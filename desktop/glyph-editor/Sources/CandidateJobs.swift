import Foundation

/// Owned, optional Python jobs. File I/O and drawing stay responsive during inference/import.
final class CandidateJobs {
    let directory: URL, tools: URL
    private var processes: [String: Process] = [:]
    init(corpus: URL, project: URL) {
        directory = project.appendingPathComponent("candidates")
        tools = corpus.deletingLastPathComponent().appendingPathComponent("desktop/glyph-editor")
    }
    deinit { for process in processes.values where process.isRunning { process.terminate() } }
    private func path(_ id: String, _ suffix: String) throws -> URL {
        guard UUID(uuidString:id) != nil else { throw fail("Невідоме завдання") }
        return directory.appendingPathComponent(id + suffix)
    }
    private func launch(_ request: [String: Any], script: String, arguments: [String], limit: Int) throws -> [String: Any] {
        guard !processes.values.contains(where:{$0.isRunning}) else { throw fail("Попереднє завдання ще триває") }
        let data = try jsonData(request); guard data.count <= limit else { throw fail("Завеликий запит") }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        processes = processes.filter { $0.value.isRunning }
        let id = UUID().uuidString, input = try path(id,".request.json"), output = try path(id,".response.json")
        try data.write(to:input,options:.atomic)
        let process = Process(); process.executableURL = URL(fileURLWithPath:"/usr/bin/env")
        process.arguments = ["python3",tools.appendingPathComponent("experiments/"+script).path] + arguments + ["--request",input.path,"--output",output.path]
        let log = try path(id,".log"); FileManager.default.createFile(atPath:log.path,contents:nil)
        let handle = try FileHandle(forWritingTo:log); process.standardOutput = handle; process.standardError = handle
        do { try process.run() } catch { try? handle.close(); throw fail("Не вдалося запустити Python: " + error.localizedDescription) }
        try? handle.close(); processes[id] = process
        return ["id":id]
    }
    func start(_ request: [String: Any]) throws -> [String: Any] {
        let data = tools.appendingPathComponent(".build/style-transfer")
        let mode = request["mode"] as? String ?? "hybrid"
        guard ["native", "retrieval", "hybrid"].contains(mode) else { throw fail("Невідомий метод генерації") }
        let required = mode == "retrieval" ? "manifest.json" : "cnn.pt"
        if mode != "native" && !FileManager.default.fileExists(atPath:data.appendingPathComponent(required).path) {
            throw fail("Локальні дані не підготовлено. Оберіть «Лише рецепти» або див. experiments/README.md.")
        }
        guard let font = request["font"] as? [String:Any], let cell = font["cell"] as? [String:Any],
              let w = cell["width"] as? Int, let h = cell["height"] as? Int, w > 0, h > 0, w <= 1024, h <= 1024, w*h <= 262144,
              let refs = request["references"] as? [[String:Any]], refs.count >= 1, refs.count <= 64 else { throw fail("Комірка 1–1024 px (до 262144 пікселів), 1–64 референси") }
        let targets = (request["targets"] as? [[String:Any]]) ?? [request]
        guard !targets.isEmpty, targets.count <= 128 else { throw fail("Пакет: 1–128 літер") }
        for item in targets {
            guard let target = item["target"] as? [String:Any], let tw = target["width"] as? Int, let th = target["height"] as? Int,
                  tw > 0, th > 0, tw <= 1024, th <= 1024, tw*th <= 262144, let char = item["character"] as? String, char.unicodeScalars.count == 1 else { throw fail("Гліф: одна літера та растр до 1024 px / 262144 пікселів") }
        }
        return try launch(request,script:"infer.py",arguments:["--data",data.path],limit:1024*1024)
    }
    func importReference(_ request: [String:Any]) throws -> [String:Any] {
        guard let data = request["data"] as? String, data.count <= 12*1024*1024,
              let name = request["name"] as? String, name.count <= 255,
              let characters = request["characters"] as? String, characters.unicodeScalars.count <= 128 else { throw fail("Референс: файл до 8 MiB та до 64 символів") }
        return try launch(request,script:"reference_import.py",arguments:[],limit:12*1024*1024)
    }
    func status(_ id: String) throws -> [String:Any] {
        let output = try path(id,".response.json")
        if FileManager.default.fileExists(atPath:output.path) {
            let data = try Data(contentsOf:output); guard data.count <= 8*1024*1024 else { throw fail("Завелика відповідь") }
            return ["status":"complete","result":try object(data)]
        }
        guard let process = processes[id] else { throw fail("Завдання скасовано або редактор перезапущено") }
        if process.isRunning { return ["status":"running"] }
        let detail = (try? String(contentsOf:try path(id,".log"),encoding:.utf8)) ?? ""
        throw fail("Завдання не вдалося. " + String(detail.suffix(1600)))
    }
    func cancel(_ id: String) throws -> Bool {
        _ = try path(id,"")
        if let process = processes[id], process.isRunning { process.terminate() }
        processes.removeValue(forKey:id); return true
    }
}
