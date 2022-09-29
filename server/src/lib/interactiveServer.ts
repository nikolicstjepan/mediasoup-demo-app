import os from "os";
import path from "path";
import repl from "repl";
import readline from "readline";
import net from "net";
import fs from "fs";
import * as mediasoup from "mediasoup";
import colors from "colors/safe";
import pidusage from "pidusage";
import heapdump from "heapdump";
import { Worker, WorkerLogLevel } from "mediasoup/node/lib/Worker";
import { WebRtcServer } from "mediasoup/node/lib/WebRtcServer";
import { Router } from "mediasoup/node/lib/Router";
import { Transport } from "mediasoup/node/lib/Transport";
import { Producer } from "mediasoup/node/lib/Producer";
import { Consumer } from "mediasoup/node/lib/Consumer";
import { DataProducer } from "mediasoup/node/lib/DataProducer";
import { DataConsumer } from "mediasoup/node/lib/DataConsumer";

const SOCKET_PATH_UNIX = "/tmp/my-demo-app.sock";
const SOCKET_PATH_WIN = path.join("\\\\?\\pipe", process.cwd(), "my-demo-app");
const SOCKET_PATH = os.platform() === "win32" ? SOCKET_PATH_WIN : SOCKET_PATH_UNIX;

// Maps to store all mediasoup objects.
const workers = new Map<string | number, Worker>();
const webRtcServers = new Map<string | number, WebRtcServer>();
const routers = new Map<string | number, Router>();
const transports = new Map<string | number, Transport>();
const producers = new Map<string | number, Producer>();
const consumers = new Map<string | number, Consumer>();
const dataProducers = new Map<string | number, DataProducer>();
const dataConsumers = new Map<string | number, DataConsumer>();

class Interactive {
    _socket: net.Socket;
    _isTerminalOpen: boolean;

    constructor(socket: net.Socket) {
        this._socket = socket;

        this._isTerminalOpen = false;
    }

    openCommandConsole() {
        this.log("\n[opening Readline Command Console...]");
        this.log("type help to print available commands");

        const cmd = readline.createInterface({
            input: this._socket,
            output: this._socket,
            terminal: true,
        });

        cmd.on("close", () => {
            if (this._isTerminalOpen) return;

            this.log("\nexiting...");

            this._socket.end();
        });

        const readStdin = () => {
            cmd.question("cmd> ", async (input) => {
                const params = input.split(/[\s\t]+/);
                const command = params.shift();

                switch (command) {
                    case "": {
                        readStdin();
                        break;
                    }

                    case "h":
                    case "help": {
                        this.log("");
                        this.log("available commands:");
                        this.log("- h,  help                    : show this message");
                        this.log(
                            "- usage                       : show CPU and memory usage of the Node.js and mediasoup-worker processes"
                        );
                        this.log(
                            "- logLevel level              : changes logLevel in all mediasoup Workers"
                        );
                        this.log(
                            "- logTags [tag] [tag]         : changes logTags in all mediasoup Workers (values separated by space)"
                        );
                        this.log("- dw, dumpWorkers             : dump mediasoup Workers");
                        this.log(
                            "- dwrs, dumpWebRtcServer [id] : dump mediasoup WebRtcServer with given id (or the latest created one)"
                        );
                        this.log(
                            "- dr, dumpRouter [id]         : dump mediasoup Router with given id (or the latest created one)"
                        );
                        this.log(
                            "- dt, dumpTransport [id]      : dump mediasoup Transport with given id (or the latest created one)"
                        );
                        this.log(
                            "- dp, dumpProducer [id]       : dump mediasoup Producer with given id (or the latest created one)"
                        );
                        this.log(
                            "- dc, dumpConsumer [id]       : dump mediasoup Consumer with given id (or the latest created one)"
                        );
                        this.log(
                            "- ddp, dumpDataProducer [id]  : dump mediasoup DataProducer with given id (or the latest created one)"
                        );
                        this.log(
                            "- ddc, dumpDataConsumer [id]  : dump mediasoup DataConsumer with given id (or the latest created one)"
                        );
                        this.log(
                            "- st, statsTransport [id]     : get stats for mediasoup Transport with given id (or the latest created one)"
                        );
                        this.log(
                            "- sp, statsProducer [id]      : get stats for mediasoup Producer with given id (or the latest created one)"
                        );
                        this.log(
                            "- sc, statsConsumer [id]      : get stats for mediasoup Consumer with given id (or the latest created one)"
                        );
                        this.log(
                            "- sdp, statsDataProducer [id] : get stats for mediasoup DataProducer with given id (or the latest created one)"
                        );
                        this.log(
                            "- sdc, statsDataConsumer [id] : get stats for mediasoup DataConsumer with given id (or the latest created one)"
                        );
                        this.log(
                            "- hs, heapsnapshot            : write a heapdump snapshot to file"
                        );
                        this.log("- t,  terminal                : open Node REPL Terminal");
                        this.log("");
                        readStdin();

                        break;
                    }

                    case "u":
                    case "usage": {
                        let usage = await pidusage(process.pid);

                        this.log(
                            `Node.js process [pid:${process.pid}]:\n${JSON.stringify(
                                usage,
                                null,
                                "  "
                            )}`
                        );

                        for (const worker of workers.values()) {
                            usage = await pidusage(worker.pid);

                            this.log(
                                `mediasoup-worker process [pid:${worker.pid}]:\n${JSON.stringify(
                                    usage,
                                    null,
                                    "  "
                                )}`
                            );
                        }

                        break;
                    }

                    case "logLevel": {
                        const level = params[0] as WorkerLogLevel | undefined;
                        const promises = [];

                        for (const worker of workers.values()) {
                            promises.push(worker.updateSettings({ logLevel: level }));
                        }

                        try {
                            await Promise.all(promises);

                            this.log("done");
                        } catch (error) {
                            this.error(String(error));
                        }

                        break;
                    }

                    case "logTags": {
                        const tags = params as mediasoup.types.WorkerLogTag[] | undefined;
                        const promises = [];

                        for (const worker of workers.values()) {
                            promises.push(worker.updateSettings({ logTags: tags }));
                        }

                        try {
                            await Promise.all(promises);

                            this.log("done");
                        } catch (error) {
                            this.error(String(error));
                        }

                        break;
                    }

                    case "dw":
                    case "dumpWorkers": {
                        for (const worker of workers.values()) {
                            try {
                                const dump = await worker.dump();

                                this.log(`worker.dump():\n${JSON.stringify(dump, null, "  ")}`);
                            } catch (error) {
                                this.error(`worker.dump() failed: ${error}`);
                            }
                        }

                        break;
                    }

                    case "dwrs":
                    case "dumpWebRtcServer": {
                        const id = params[0] || Array.from(webRtcServers.keys()).pop();
                        const webRtcServer = typeof id !== "undefined" && webRtcServers.get(id);

                        if (!webRtcServer) {
                            this.error("WebRtcServer not found");

                            break;
                        }

                        try {
                            const dump = await webRtcServer.dump();

                            this.log(`webRtcServer.dump():\n${JSON.stringify(dump, null, "  ")}`);
                        } catch (error) {
                            this.error(`webRtcServer.dump() failed: ${error}`);
                        }

                        break;
                    }

                    case "dr":
                    case "dumpRouter": {
                        const id = params[0] || Array.from(routers.keys()).pop();
                        const router = typeof id !== "undefined" && routers.get(id);

                        if (!router) {
                            this.error("Router not found");

                            break;
                        }

                        try {
                            const dump = await router.dump();

                            this.log(`router.dump():\n${JSON.stringify(dump, null, "  ")}`);
                        } catch (error) {
                            this.error(`router.dump() failed: ${error}`);
                        }

                        break;
                    }

                    case "dt":
                    case "dumpTransport": {
                        const id = params[0] || Array.from(transports.keys()).pop();
                        const transport = typeof id !== "undefined" && transports.get(id);

                        if (!transport) {
                            this.error("Transport not found");

                            break;
                        }

                        try {
                            const dump = await transport.dump();

                            this.log(`transport.dump():\n${JSON.stringify(dump, null, "  ")}`);
                        } catch (error) {
                            this.error(`transport.dump() failed: ${error}`);
                        }

                        break;
                    }

                    case "dp":
                    case "dumpProducer": {
                        const id = params[0] || Array.from(producers.keys()).pop();
                        const producer = typeof id !== "undefined" && producers.get(id);

                        if (!producer) {
                            this.error("Producer not found");

                            break;
                        }

                        try {
                            const dump = await producer.dump();

                            this.log(`producer.dump():\n${JSON.stringify(dump, null, "  ")}`);
                        } catch (error) {
                            this.error(`producer.dump() failed: ${error}`);
                        }

                        break;
                    }

                    case "dc":
                    case "dumpConsumer": {
                        const id = params[0] || Array.from(consumers.keys()).pop();
                        const consumer = typeof id !== "undefined" && consumers.get(id);

                        if (!consumer) {
                            this.error("Consumer not found");

                            break;
                        }

                        try {
                            const dump = await consumer.dump();

                            this.log(`consumer.dump():\n${JSON.stringify(dump, null, "  ")}`);
                        } catch (error) {
                            this.error(`consumer.dump() failed: ${error}`);
                        }

                        break;
                    }

                    case "ddp":
                    case "dumpDataProducer": {
                        const id = params[0] || Array.from(dataProducers.keys()).pop();
                        const dataProducer = typeof id !== "undefined" && dataProducers.get(id);

                        if (!dataProducer) {
                            this.error("DataProducer not found");

                            break;
                        }

                        try {
                            const dump = await dataProducer.dump();

                            this.log(`dataProducer.dump():\n${JSON.stringify(dump, null, "  ")}`);
                        } catch (error) {
                            this.error(`dataProducer.dump() failed: ${error}`);
                        }

                        break;
                    }

                    case "ddc":
                    case "dumpDataConsumer": {
                        const id = params[0] || Array.from(dataConsumers.keys()).pop();
                        const dataConsumer = typeof id !== "undefined" && dataConsumers.get(id);

                        if (!dataConsumer) {
                            this.error("DataConsumer not found");

                            break;
                        }

                        try {
                            const dump = await dataConsumer.dump();

                            this.log(`dataConsumer.dump():\n${JSON.stringify(dump, null, "  ")}`);
                        } catch (error) {
                            this.error(`dataConsumer.dump() failed: ${error}`);
                        }

                        break;
                    }

                    case "st":
                    case "statsTransport": {
                        const id = params[0] || Array.from(transports.keys()).pop();
                        const transport = typeof id !== "undefined" && transports.get(id);

                        if (!transport) {
                            this.error("Transport not found");

                            break;
                        }

                        try {
                            const stats = await transport.getStats();

                            this.log(`transport.getStats():\n${JSON.stringify(stats, null, "  ")}`);
                        } catch (error) {
                            this.error(`transport.getStats() failed: ${error}`);
                        }

                        break;
                    }

                    case "sp":
                    case "statsProducer": {
                        const id = params[0] || Array.from(producers.keys()).pop();
                        const producer = typeof id !== "undefined" && producers.get(id);

                        if (!producer) {
                            this.error("Producer not found");

                            break;
                        }

                        try {
                            const stats = await producer.getStats();

                            this.log(`producer.getStats():\n${JSON.stringify(stats, null, "  ")}`);
                        } catch (error) {
                            this.error(`producer.getStats() failed: ${error}`);
                        }

                        break;
                    }

                    case "sc":
                    case "statsConsumer": {
                        const id = params[0] || Array.from(consumers.keys()).pop();
                        const consumer = typeof id !== "undefined" && consumers.get(id);

                        if (!consumer) {
                            this.error("Consumer not found");

                            break;
                        }

                        try {
                            const stats = await consumer.getStats();

                            this.log(`consumer.getStats():\n${JSON.stringify(stats, null, "  ")}`);
                        } catch (error) {
                            this.error(`consumer.getStats() failed: ${error}`);
                        }

                        break;
                    }

                    case "sdp":
                    case "statsDataProducer": {
                        const id = params[0] || Array.from(dataProducers.keys()).pop();
                        const dataProducer = typeof id !== "undefined" && dataProducers.get(id);

                        if (!dataProducer) {
                            this.error("DataProducer not found");

                            break;
                        }

                        try {
                            const stats = await dataProducer.getStats();

                            this.log(
                                `dataProducer.getStats():\n${JSON.stringify(stats, null, "  ")}`
                            );
                        } catch (error) {
                            this.error(`dataProducer.getStats() failed: ${error}`);
                        }

                        break;
                    }

                    case "sdc":
                    case "statsDataConsumer": {
                        const id = params[0] || Array.from(dataConsumers.keys()).pop();
                        const dataConsumer = typeof id !== "undefined" && dataConsumers.get(id);

                        if (!dataConsumer) {
                            this.error("DataConsumer not found");

                            break;
                        }

                        try {
                            const stats = await dataConsumer.getStats();

                            this.log(
                                `dataConsumer.getStats():\n${JSON.stringify(stats, null, "  ")}`
                            );
                        } catch (error) {
                            this.error(`dataConsumer.getStats() failed: ${error}`);
                        }

                        break;
                    }

                    case "hs":
                    case "heapsnapshot": {
                        const filename = `${
                            process.env.SNAPSHOT_DIR || "/tmp"
                        }/${Date.now()}-mediasoup-demo.heapsnapshot`;

                        // eslint-disable-next-line no-shadow
                        heapdump.writeSnapshot(filename, (error, filename) => {
                            if (!error) {
                                this.log(`heapdump snapshot writen to ${filename}`);
                                this.log(
                                    "learn how to use it at https://github.com/bnoordhuis/node-heapdump"
                                );
                            } else {
                                this.error(`heapdump snapshot failed: ${error}`);
                            }
                        });

                        break;
                    }

                    case "t":
                    case "terminal": {
                        this._isTerminalOpen = true;

                        cmd.close();
                        this.openTerminal();

                        return;
                    }

                    default: {
                        this.error(`unknown command '${command}'`);
                        this.log("press 'h' or 'help' to get the list of available commands");
                    }
                }

                readStdin();
            });
        };

        readStdin();
    }

    openTerminal() {
        this.log("\n[opening Node REPL Terminal...]");
        this.log(
            "here you have access to workers, webRtcServers, routers, transports, producers, consumers, dataProducers and dataConsumers ES6 maps"
        );

        const terminal = repl.start({
            input: this._socket,
            output: this._socket,
            terminal: true,
            prompt: "terminal> ",
            useColors: true,
            useGlobal: true,
            ignoreUndefined: false,
            preview: false,
        });

        this._isTerminalOpen = true;

        terminal.on("exit", () => {
            this.log("\n[exiting Node REPL Terminal...]");

            this._isTerminalOpen = false;

            this.openCommandConsole();
        });
    }

    log(msg: string) {
        this._socket.write(`${colors.green(msg)}\n`);
    }

    error(msg: string) {
        this._socket.write(`${colors.bold(colors.red("ERROR: "))}${colors.red(msg)}\n`);
    }
}

function runMediasoupObserver() {
    mediasoup.observer.on("newworker", (worker) => {
        global.worker = worker;

        workers.set(worker.pid, worker);
        worker.observer.on("close", () => workers.delete(worker.pid));

        worker.observer.on("newwebrtcserver", (webRtcServer) => {
            global.webRtcServer = webRtcServer;

            webRtcServers.set(webRtcServer.id, webRtcServer);
            webRtcServer.observer.on("close", () => webRtcServers.delete(webRtcServer.id));
        });

        worker.observer.on("newrouter", (router) => {
            // Store the latest router in a global variable.
            global.router = router;

            routers.set(router.id, router);
            router.observer.on("close", () => routers.delete(router.id));

            router.observer.on("newtransport", (transport) => {
                // Store the latest transport in a global variable.
                global.transport = transport;

                transports.set(transport.id, transport);
                transport.observer.on("close", () => transports.delete(transport.id));

                transport.observer.on("newproducer", (producer) => {
                    // Store the latest producer in a global variable.
                    global.producer = producer;

                    producers.set(producer.id, producer);
                    producer.observer.on("close", () => producers.delete(producer.id));
                });

                transport.observer.on("newconsumer", (consumer) => {
                    // Store the latest consumer in a global variable.
                    global.consumer = consumer;

                    consumers.set(consumer.id, consumer);
                    consumer.observer.on("close", () => consumers.delete(consumer.id));
                });

                transport.observer.on("newdataproducer", (dataProducer) => {
                    // Store the latest dataProducer in a global variable.
                    global.dataProducer = dataProducer;

                    dataProducers.set(dataProducer.id, dataProducer);
                    dataProducer.observer.on("close", () => dataProducers.delete(dataProducer.id));
                });

                transport.observer.on("newdataconsumer", (dataConsumer) => {
                    // Store the latest dataConsumer in a global variable.
                    global.dataConsumer = dataConsumer;

                    dataConsumers.set(dataConsumer.id, dataConsumer);
                    dataConsumer.observer.on("close", () => dataConsumers.delete(dataConsumer.id));
                });
            });
        });
    });
}

export default async function startInteractiveServer(): Promise<void> {
    // Run the mediasoup observer API.
    runMediasoupObserver();

    // Make maps global so they can be used during the REPL terminal.
    global.workers = workers;
    global.routers = routers;
    global.transports = transports;
    global.producers = producers;
    global.consumers = consumers;
    global.dataProducers = dataProducers;
    global.dataConsumers = dataConsumers;

    const server = net.createServer((socket) => {
        const interactive = new Interactive(socket);

        interactive.openCommandConsole();
    });

    await new Promise((resolve) => {
        try {
            fs.unlinkSync(SOCKET_PATH);
        } catch (error) {}

        server.listen(SOCKET_PATH, () => resolve(true));
    });
}
