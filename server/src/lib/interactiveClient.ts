import net from "net";
import os from "os";
import path from "path";

const SOCKET_PATH_UNIX = "/tmp/my-demo-app.sock";
const SOCKET_PATH_WIN = path.join("\\\\?\\pipe", process.cwd(), "my-demo-app");
const SOCKET_PATH = os.platform() === "win32" ? SOCKET_PATH_WIN : SOCKET_PATH_UNIX;

export default async function startInteractiveClient() {
    const socket = net.connect(SOCKET_PATH);

    process.stdin.pipe(socket);
    socket.pipe(process.stdout);

    socket.on("connect", () => process.stdin.isTTY && process.stdin.setRawMode(true));
    socket.on("close", () => process.exit(0));
    socket.on("exit", () => socket.end());
}
