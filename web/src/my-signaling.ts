import protooClient from "protoo-client";

const transport = new protooClient.WebSocketTransport("wss://my-app.test:4443/?roomId=1&peerId=1");

const peer = new protooClient.Peer(transport);

console.log({ peer });

const ensureConnection = () =>
    new Promise((res, rej) => {
        if (peer.connected) res(true);
        peer.on("failed", rej);
        peer.on("open", () => res(true));
    });

const request = async (type: string, data: any) => {
    await ensureConnection();
    switch (type) {
        case "getRouterRtpCapabilities": {
            const routerCapabilities = await peer.request("getRouterRtpCapabilities");

            console.log({ routerCapabilities });
            return routerCapabilities;
        }

        case "createTransport": {
            const transport = await peer.request("createWebRtcTransport", data);

            console.log({ transport });
            return transport;
        }

        case "transportConnect": {
            const con = await peer.request("connectWebRtcTransport", data);

            console.log({ con });
            return con;
        }

        case "produce": {
            const prod = await peer.request("produce", data);

            console.log({ prod });
            return prod;
        }

        case "produceData": {
            const prodD = await peer.request("produceData", data);

            console.log({ prodD });
            return prodD;
        }

        case "join": {
            const joins = await peer.request("join", data);

            console.log({ joins });
            return joins;
        }

        default: {
            throw new Error("Unknown request type");
        }
    }
};

export default {
    request,
};
