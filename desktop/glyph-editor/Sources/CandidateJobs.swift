import Foundation

/// Optional local inference runs in an owned process, outside the file I/O queue.
final class CandidateJobs {
    let corpus: URL, directory: URL, tools: URL
    private var processes: [String: Process] = [:]
    init(corpus: URL, project: URL) {
        self.corpus = corpus; directory = project.appendingPathComponent("candidates")
        tools = corpus.deletingLastPathComponent().appendingPathComponent("desktop/glyph-editor")
    }
    deinit { for process in processes.values where process.isRunning { process.terminate() } }
    private func path(_ id: String, _ suffix: String) throws -> URL {
        guard UUID(uuidString:id) != nil else { throw fail("Невідоме завдання генерації") }
        return directory.appendingPathComponent(id + suffix)
    }
    func start(_ request: [String: Any]) throws -> [String: Any] {
        guard processes.values.filter({ $0.isRunning }).count < 1 else { throw fail("Генерація вже триває") }
        let checkpoint = tools.appendingPathComponent(".build/style-transfer/cnn.pt")
        guard FileManager.default.fileExists(atPath: checkpoint.path) else { throw fail("Локальну модель не підготовлено. Див. experiments/README.md.") }
        guard let font = request["font"] as? [String: Any], let cell = font["cell"] as? [String: Any],
              let w = cell["width"] as? Int, let h = cell["height"] as? Int, w > 0, h > 0, w <= 32, h <= 32,
              let target = request["target"] as? [String: Any], let tw = target["width"] as? Int, let th = target["height"] as? Int,
              tw > 0, th > 0, tw <= 32, th <= 32,
              let references = request["references"] as? [[String: Any]], references.count >= 2, references.count <= 12,
              let char = request["character"] as? String, char.unicodeScalars.count == 1 else { throw fail("Прототип: комірка та гліф 1–32 px, щонайменше два референси") }
        let data = try jsonData(request); guard data.count < 128*1024 else { throw fail("Завеликий запит генерації") }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        // Bound in-memory handles; response files remain available until project cleanup.
        processes = processes.filter { $0.value.isRunning }
        let id = UUID().uuidString, input = try path(id,".request.json"), output = try path(id,".response.json")
        try data.write(to:input, options:.atomic)
        let process = Process(); process.executableURL = URL(fileURLWithPath:"/usr/bin/env")
        process.arguments = ["python3",tools.appendingPathComponent("experiments/infer.py").path,"--data",checkpoint.deletingLastPathComponent().path,"--request",input.path,"--output",output.path]
        let log = try path(id,".log"); FileManager.default.createFile(atPath:log.path,contents:nil)
        let handle = try FileHandle(forWritingTo:log); process.standardOutput = handle; process.standardError = handle
        do { try process.run() } catch { try? handle.close(); throw fail("Не вдалося запустити Python: " + error.localizedDescription) }
        try? handle.close(); processes[id] = process
        return ["id":id]
    }
    func status(_ id: String) throws -> [String: Any] {
        let output = try path(id,".response.json")
        if FileManager.default.fileExists(atPath: output.path) {
            let data = try Data(contentsOf: output); guard data.count < 1024*1024 else { throw fail("Завелика відповідь генерації") }
            return ["status":"complete","result":try object(data)]
        }
        guard let process = processes[id] else { throw fail("Завдання завершено або редактор перезапущено. Повторіть генерацію.") }
        if process.isRunning { return ["status":"running"] }
        let log = try path(id,".log"); let detail = (try? String(contentsOf:log,encoding:.utf8)) ?? ""
        throw fail("Генерація не вдалася. " + String(detail.suffix(1600)))
    }
    func cancel(_ id: String) throws -> Bool {
        _ = try path(id,"")
        if let process = processes[id], process.isRunning { process.terminate() }
        processes.removeValue(forKey:id)
        return true
    }
}
