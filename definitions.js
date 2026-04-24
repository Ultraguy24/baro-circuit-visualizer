const COMPONENT_DEFS = {
    "orcomponent": {
        name: "OR",
        leftPins: ["signal_in1", "signal_in2", "set_output"],
        rightPins: ["signal_out"],
        properties: ["timeframe", "output", "falseoutput"]
    },
    "andcomponent": {
        name: "AND",
        leftPins: ["signal_in1", "signal_in2", "set_output"],
        rightPins: ["signal_out"],
        properties: ["timeframe", "output", "falseoutput"]
    },
    "memorycomponent": {
        name: "MEMORY",
        leftPins: ["signal_in", "lock_state"],
        rightPins: ["signal_out"],
        properties: ["value"]
    },
    "greatercomponent": {
        name: "GREATER THAN",
        leftPins: ["signal_in1", "signal_in2", "set_output"],
        rightPins: ["signal_out"],
        properties: ["output", "falseoutput", "timeframe"]
    },
    "signalcheckcomponent": {
        name: "SIGNAL CHECK",
        leftPins: ["signal_in", "set_targetsignal", "set_output", "set_falseoutput"],
        rightPins: ["signal_out"],
        properties: ["targetsignal", "output", "falseoutput"]
    },
    "dividecomponent": {
        name: "DIVIDE",
        leftPins: ["signal_in1", "signal_in2"],
        rightPins: ["signal_out"],
        properties: ["clamp_max", "clamp_min", "timeframe"]
    },
    "multiplycomponent": {
        name: "MULTIPLY",
        leftPins: ["signal_in1", "signal_in2"],
        rightPins: ["signal_out"],
        properties: ["clamp_max", "clamp_min", "timeframe"]
    },
    "addcomponent": {
        name: "ADD",
        leftPins: ["signal_in1", "signal_in2"],
        rightPins: ["signal_out"],
        properties: ["clamp_max", "clamp_min", "timeframe"]
    },
    "subtractcomponent": {
        name: "SUBTRACT",
        leftPins: ["signal_in1", "signal_in2"],
        rightPins: ["signal_out"],
        properties: ["clamp_max", "clamp_min", "timeframe"]
    },
    "relaycomponent": {
        name: "RELAY",
        leftPins: ["power_in", "signal_in1", "signal_in2", "signal_in3", "signal_in4", "signal_in5", "toggle_state", "set_state"],
        rightPins: ["power_out", "signal_out1", "signal_out2", "signal_out3", "signal_out4", "signal_out5", "state_out", "load_value_out", "power_value_out"],
        properties: ["ison"]
    },
    "delaycomponent": {
        name: "DELAY",
        leftPins: ["signal_in", "set_delay"],
        rightPins: ["signal_out"],
        properties: [
            "delay",
            "resetwhensignalreceived",
            "resetwhendifferentsignalreceived"
        ]
    },
    "roundcomponent": {
        name: "ROUND",
        leftPins: ["signal_in"],
        rightPins: ["signal_out"],
        properties: []
    },
    "floorcomponent": {
        name: "FLOOR",
        leftPins: ["signal_in"],
        rightPins: ["signal_out"],
        properties: []
    },
    "addercomponent": {
        name: "ADDER",
        leftPins: ["signal_in1", "signal_in2"],
        rightPins: ["signal_out"],
        properties: ["clamp_max", "clamp_min", "timeframe"]
    },
    "wificomponent": {
        name: "WIFI",
        leftPins: ["signal_in", "set_channel"],
        rightPins: ["signal_out"],
        properties: ["channel"]
    },
    "notcomponent": {
        name: "NOT",
        leftPins: ["signal_in"],
        rightPins: ["signal_out"],
        properties: ["continuousoutput"]
    },
    "concatcomponent": {
        name: "CONCATENATION",
        leftPins: ["signal_in1", "signal_in2"],
        rightPins: ["signal_out"],
        properties: ["separator", "timeframe"]
    }
};
