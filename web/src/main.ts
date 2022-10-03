import { Device } from "mediasoup-client";
import mySignaling from "./my-signaling";

const streamButton = document.getElementById("stream-btn");

streamButton?.addEventListener("click", () => {
    console.log("stream");
});

const run = async () => {
    // Create a device (use browser auto-detection).
    const device = new Device();

    // Communicate with our server app to retrieve router RTP capabilities.
    const routerRtpCapabilities = await mySignaling.request("getRouterRtpCapabilities", {});

    // Load the device with the router RTP capabilities.
    await device.load({ routerRtpCapabilities });

    // Check whether we can produce video to the router.
    if (!device.canProduce("video")) {
        console.warn("cannot produce video");

        // Abort next steps.
    }

    // Create a transport in the server for sending our media through it.
    const { id, iceParameters, iceCandidates, dtlsParameters, sctpParameters } =
        await mySignaling.request("createTransport", {
            sctpCapabilities: device.sctpCapabilities,
        });

    // Create the local representation of our server-side transport.
    const sendTransport = device.createSendTransport({
        id,
        iceParameters,
        iceCandidates,
        dtlsParameters,
        sctpParameters,
    });

    // Set transport "connect" event handler.
    sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        // Here we must communicate our local parameters to our remote transport.
        try {
            console.log("connect");

            await mySignaling.request("transportConnect", {
                transportId: sendTransport.id,
                dtlsParameters,
            });

            // Done in the server, tell our transport.
            callback();
        } catch (error) {
            // Something was wrong in server side.
            console.log({ error });
            errback(error as Error);
        }
    });

    // Set transport "produce" event handler.
    sendTransport.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
        // Here we must communicate our local parameters to our remote transport.
        try {
            const { id } = await mySignaling.request("produce", {
                transportId: sendTransport.id,
                kind,
                rtpParameters,
                appData,
            });

            // Done in the server, pass the response to our transport.
            callback({ id });
        } catch (error) {
            // Something was wrong in server side.
            errback(error as Error);
        }
    });

    // Set transport "producedata" event handler.
    sendTransport.on(
        "producedata",
        async ({ sctpStreamParameters, label, protocol, appData }, callback, errback) => {
            // Here we must communicate our local parameters to our remote transport.
            try {
                const { id } = await mySignaling.request("produceData", {
                    transportId: sendTransport.id,
                    sctpStreamParameters,
                    label,
                    protocol,
                    appData,
                });

                // Done in the server, pass the response to our transport.
                callback({ id });
            } catch (error) {
                // Something was wrong in server side.
                errback(error as Error);
            }
        }
    );

    const { peers } = await mySignaling.request("join", {
        displayName: "mirkec",
        device: device,
        rtpCapabilities: device.rtpCapabilities,
        sctpCapabilities: device.sctpCapabilities,
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const webcamTrack = stream.getVideoTracks()[0];
    const webcamProducer = await sendTransport.produce({ track: webcamTrack });
};

run();

/* 
  
  
  
  
  
  
  // Produce our webcam video.
  
  // Produce data (DataChannel).
  const dataProducer =
    await sendTransport.produceData({ ordered: true, label: 'foo' });
 */
