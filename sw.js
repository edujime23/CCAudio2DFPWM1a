const SAMPLE_RATE = 48000;
const PREC = 10;

const encodeDfpwm = (input) => {
    let charge = 0;
    let strength = 0;
    let previousBit = false;
    const out = new Int8Array(Math.floor(input.length / 8));

    for (let i = 0; i < out.length; i++) {
        let thisByte = 0;

        for (let j = 0; j < 8; j++) {
            const level = Math.floor(input[i * 8 + j] * 127);
            const currentBit = level > charge || (level === charge && charge === 127);
            const target = currentBit ? 127 : -128;

            let nextCharge = charge + ((strength * (target - charge) + (1 << (PREC - 1))) >> PREC);
            if (nextCharge === charge && nextCharge !== target) nextCharge += currentBit ? 1 : -1;

            const z = currentBit === previousBit ? (1 << PREC) - 1 : 0;
            let nextStrength = strength;
            if (strength !== z) nextStrength += currentBit === previousBit ? 1 : -1;
            if (nextStrength < 2 << (PREC - 8)) nextStrength = 2 << (PREC - 8);

            charge = nextCharge;
            strength = nextStrength;
            previousBit = currentBit;

            thisByte = currentBit ? (thisByte >> 1) + 128 : thisByte >> 1;
        }

        out[i] = thisByte;
    }

    return out;
};

self.addEventListener("fetch", async (event) => {
    const url = new URL(event.request.url);
    if (url.pathname === "/convert" && event.request.method === "POST") {
        event.respondWith(handleConversion(event.request));
    }
});

async function handleConversion(request) {
    const formData = await request.formData();
    
    let file = formData.get("file");
    let fileUrl = formData.get("url");

    if (!file && !fileUrl) {
        return new Response(JSON.stringify({ error: "No file or URL provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    let arrayBuffer;
    
    if (fileUrl) {
        try {
            console.log("Fetching audio from URL:", fileUrl);
            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error("Failed to fetch audio file");
            arrayBuffer = await response.arrayBuffer();
        } catch (error) {
            return new Response(JSON.stringify({ error: "Failed to fetch file", details: error.message }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
    } else {
        arrayBuffer = await file.arrayBuffer();
    }

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const offlineContext = new OfflineAudioContext({
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
        length: Math.ceil(audioBuffer.duration * SAMPLE_RATE),
    });

    const inputSource = offlineContext.createBufferSource();
    inputSource.buffer = audioBuffer;
    inputSource.connect(offlineContext.destination);
    inputSource.start();

    const rendered = await offlineContext.startRendering();
    const pcmData = rendered.getChannelData(0);

    const dfpwmData = encodeDfpwm(pcmData);
    const blob = new Blob([dfpwmData], { type: "application/octet-stream" });

    return new Response(blob, { headers: { "Content-Type": "application/octet-stream" } });
}