import {
    Consumer,
    DataConsumer,
    DataProducer,
    Producer,
    Router,
    Transport,
    WebRtcServer,
    Worker,
    AudioLevelObserver,
} from "mediasoup/node/lib/types";
import Bot from "./lib/Bot";

declare global {
    var worker: Worker;
    var webRtcServer: WebRtcServer;
    var router: Router;
    var transport: Transport;
    var producer: Producer;
    var consumer: Consumer;
    var dataProducer: DataProducer;
    var dataConsumer: DataConsumer;
    var workers: Map<string | number, Worker>;
    var routers: Map<string | number, Router>;
    var transports: Map<string | number, Transport>;
    var producers: Map<string | number, Producer>;
    var consumers: Map<string | number, Consumer>;
    var dataProducers: Map<string | number, DataProducer>;
    var dataConsumers: Map<string | number, DataConsumer>;
    var audioLevelObserver: AudioLevelObserver;
    var bot: Bot;

    namespace Express {
        interface Request {
            room?: any;
        }
    }
}
