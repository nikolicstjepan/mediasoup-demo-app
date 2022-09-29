const utils: Record<string, any> = {};

utils.clone = function (data: any, defaultValue: any) {
    if (typeof data === "undefined") return defaultValue;

    return JSON.parse(JSON.stringify(data));
};

export default utils;
