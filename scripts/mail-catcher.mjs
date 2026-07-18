// Minimal SMTP server that accepts any mail and writes it to mail-NNN.eml
import net from "net";
import fs from "fs";

let n = 0;
net
  .createServer((sock) => {
    let buf = "";
    let inData = false;
    let raw = "";
    sock.write("220 mailcatcher ready\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            const file = `mail-${String(n++).padStart(3, "0")}.eml`;
            fs.writeFileSync(file, raw);
            console.log("captured", file);
            raw = "";
            sock.write("250 OK stored\r\n");
          } else {
            raw += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
          }
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) sock.write("250 mailcatcher\r\n");
        else if (cmd.startsWith("MAIL") || cmd.startsWith("RCPT") || cmd.startsWith("NOOP") || cmd.startsWith("RSET"))
          sock.write("250 OK\r\n");
        else if (cmd.startsWith("DATA")) {
          inData = true;
          sock.write("354 go ahead\r\n");
        } else if (cmd.startsWith("QUIT")) {
          sock.write("221 bye\r\n");
          sock.end();
        } else sock.write("250 OK\r\n");
      }
    });
  })
  .listen(1025, "127.0.0.1", () => console.log("smtp catcher on 127.0.0.1:1025"));
