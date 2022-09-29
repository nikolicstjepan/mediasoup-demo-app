declare namespace Express {
    export interface Request {
        room?: any;
    }
}

declare module "@sitespeed.io/throttle" {
    export async function start(any?): Promise<void>;
    export async function stop(any?): Promise<void>;
}
