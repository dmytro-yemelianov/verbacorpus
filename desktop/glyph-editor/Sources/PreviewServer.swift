import Foundation
import Network

/// Development-only loopback transport uses exactly the same store as the app.
final class PreviewServer {
    let listener: NWListener
    let store: EditorStore
    let resources: URL
    let origin: String
    let queue = DispatchQueue(label: "verba.glyph.preview")
    init(port: UInt16, store: EditorStore, resources: URL) throws {
        self.store = store; self.resources = resources; self.origin = "http://127.0.0.1:\(port)"
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [weak self] connection in
            guard let self = self else { return }; connection.start(queue: self.queue); self.receive(connection, data: Data())
        }
        listener.stateUpdateHandler = { state in if case .ready = state { print("http://127.0.0.1:\(port)/"); fflush(stdout) } }
        listener.start(queue: queue)
    }
    private func receive(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1024*1024) { [weak self] chunk, _, complete, error in
            guard let self = self else { return }
            var buffer = data; if let chunk = chunk { buffer.append(chunk) }
            if buffer.count > 20*1024*1024 { self.reply(connection, status: 413, body: Data()); return }
            guard let end = buffer.range(of: Data("\r\n\r\n".utf8)), let header = String(data: buffer[..<end.lowerBound], encoding: .utf8) else {
                if !complete && error == nil { self.receive(connection, data: buffer) } else { connection.cancel() }; return
            }
            guard header.utf8.count <= 65536 else { self.reply(connection,status:413,body:Data()); return }
            let lines = header.components(separatedBy: "\r\n"), request = lines[0].components(separatedBy: " ")
            let lengths = lines.dropFirst().filter { $0.lowercased().hasPrefix("content-length:") }
            let length = lengths.first.flatMap { Int($0.dropFirst("content-length:".count).trimmingCharacters(in:.whitespaces)) } ?? (lengths.isEmpty ? 0 : -1)
            guard lengths.count <= 1, length >= 0, length <= 20*1024*1024 else { self.reply(connection,status:400,body:Data()); return }
            if buffer.count - end.upperBound < length {
                if complete || error != nil { connection.cancel() } else { self.receive(connection, data: buffer) }
                return
            }
            guard request.count >= 2 else { connection.cancel(); return }
            do {
                if request[0] == "POST" && request[1] == "/bridge" {
                    guard lines.contains(where: { $0.lowercased() == "origin: " + self.origin }) else { throw fail("Недозволене джерело запиту") }
                    let input = try object(buffer.subdata(in: end.upperBound..<(end.upperBound + length)))
                    let value = try self.store.command(input["action"] as? String ?? "", input["args"] as? [String: Any] ?? [:])
                    self.reply(connection, body: try jsonData(["ok": true, "value": value]))
                } else if request[0] == "GET" {
                    let path = request[1].components(separatedBy: "?")[0]
                    if path == "/favicon.ico" { self.reply(connection, status: 204, body: Data()); return }
                    let file = path == "/" ? "editor.html" : String(path.dropFirst())
                    guard ["editor.html","editor.js","editor.css"].contains(file) else { self.reply(connection, status: 404, body: Data()); return }
                    let mime = file.hasSuffix(".js") ? "text/javascript" : file.hasSuffix(".css") ? "text/css" : "text/html"
                    self.reply(connection, body: try Data(contentsOf: self.resources.appendingPathComponent(file)), mime: mime)
                } else { self.reply(connection, status: 405, body: Data()) }
            } catch { self.reply(connection, body: (try? jsonData(["ok": false,"error": error.localizedDescription])) ?? Data()) }
        }
    }
    private func reply(_ connection: NWConnection, status: Int = 200, body: Data, mime: String = "application/json") {
        let header = "HTTP/1.1 \(status) OK\r\nContent-Type: \(mime); charset=utf-8\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(header.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
    }
}
