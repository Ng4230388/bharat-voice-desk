
"use client";

import { useEffect, useRef, useState } from "react";

type Language = "Hindi" | "English" | "Marathi";

export default function Home() {
  const [language, setLanguage] = useState<Language>("Hindi");
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Ready to listen");
  const [transcript, setTranscript] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [error, setError] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");
  const [speechUrl, setSpeechUrl] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      if (speechUrl) URL.revokeObjectURL(speechUrl);

      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    };
  }, [recordingUrl, speechUrl]);

  async function convertToWav(blob: Blob): Promise<Blob> {
    const context = new AudioContext();

    try {
      const decoded = await context.decodeAudioData(
        await blob.arrayBuffer()
      );

      const targetRate = 16000;
      const ratio = decoded.sampleRate / targetRate;
      const outputLength = Math.ceil(decoded.length / ratio);
      const mono = new Float32Array(outputLength);

      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = Math.min(
          Math.floor(i * ratio),
          decoded.length - 1
        );

        let sum = 0;

        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          sum += decoded.getChannelData(channel)[sourceIndex];
        }

        mono[i] = sum / decoded.numberOfChannels;
      }

      const buffer = new ArrayBuffer(44 + outputLength * 2);
      const view = new DataView(buffer);

      function writeString(offset: number, value: string) {
        for (let i = 0; i < value.length; i++) {
          view.setUint8(offset + i, value.charCodeAt(i));
        }
      }

      writeString(0, "RIFF");
      view.setUint32(4, 36 + outputLength * 2, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, targetRate, true);
      view.setUint32(28, targetRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, outputLength * 2, true);

      for (let i = 0; i < outputLength; i++) {
        const sample = Math.max(-1, Math.min(1, mono[i]));
        const value = sample < 0
          ? sample * 32768
          : sample * 32767;

        view.setInt16(44 + i * 2, value, true);
      }

      return new Blob([buffer], { type: "audio/wav" });
    } finally {
      await context.close();
    }
  }

  async function generateAIAnswer(text: string): Promise<string> {
    setStatus("Gemini is thinking...");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript: text,
        language,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Gemini response failed.");
    }

    if (!result.answer) {
      throw new Error("Gemini returned an empty response.");
    }

    setAiAnswer(result.answer);
    return result.answer;
  }

  async function generateSpeech(text: string) {
    setStatus("Generating your AI voice...");

    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        language,
      }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(
        result?.error || "Unable to generate spoken response."
      );
    }

    const audioBlob = await response.blob();

    if (!audioBlob.size) {
      throw new Error("Timbre returned an empty audio file.");
    }

    const newUrl = URL.createObjectURL(audioBlob);

    setSpeechUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return newUrl;
    });

    setStatus("Your AI voice response is ready!");
  }

  async function transcribeAudio(blob: Blob) {
    setLoading(true);
    setError("");
    setTranscript("");
    setAiAnswer("");
    setStatus("Preparing your voice...");

    setSpeechUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return "";
    });

    try {
      const wavBlob = await convertToWav(blob);

      const file = new File(
        [wavBlob],
        "bharat-voice-recording.wav",
        { type: "audio/wav" }
      );

      const form = new FormData();
      form.append("audio", file);
      form.append("language", language);

      setStatus("Gnani Prisma is listening...");

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Transcription failed.");
      }

      if (!result.transcript) {
        throw new Error("No speech detected.");
      }

      setTranscript(result.transcript);

      const answer = await generateAIAnswer(result.transcript);

      try {
        await generateSpeech(answer);
      } catch (ttsError) {
        setStatus("AI answer ready; voice generation failed.");
        setError(
          ttsError instanceof Error
            ? ttsError.message
            : "Voice generation failed."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );

      setStatus("Processing incomplete");
    } finally {
      setLoading(false);
    }
  }

  async function startRecording() {
    try {
      setError("");
      setTranscript("");
      setAiAnswer("");

      setRecordingUrl((oldUrl) => {
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        return "";
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? { mimeType: "audio/webm;codecs=opus" }
        : undefined;

      const recorder = new MediaRecorder(stream, options);

      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType,
        });

        if (!blob.size) {
          setError("No audio recorded. Please try again.");
          setStatus("Ready to listen");
          return;
        }

        setRecordingUrl(URL.createObjectURL(blob));
        await transcribeAudio(blob);
      };

      recorder.start();
      setRecording(true);
      setStatus("Recording your voice...");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Please allow microphone access."
      );

      setStatus("Microphone unavailable");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setRecording(false);
      setStatus("Processing your recording...");
    }
  }

  function clearAll() {
    setTranscript("");
    setAiAnswer("");
    setError("");

    setRecordingUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return "";
    });

    setSpeechUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return "";
    });

    setStatus("Ready to listen");
  }

  const isBusy = recording || loading;

  return (
    <main className="min-h-screen overflow-hidden bg-[#070914] text-white">

      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-52 left-1/4 h-[500px] w-[500px] rounded-full bg-cyan-500/[0.07] blur-[130px]" />
        <div className="absolute right-0 top-1/3 h-[450px] w-[450px] rounded-full bg-violet-600/[0.07] blur-[140px]" />
      </div>

      {/* Navigation */}
      <header className="relative z-10 border-b border-white/[0.07]">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-10">

          <a href="#" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-blue-500 text-xl font-black text-[#07101d] shadow-lg shadow-cyan-500/20">
              B
            </div>

            <div>
              <h1 className="text-lg font-bold tracking-tight">
                Bharat<span className="text-cyan-400">Voice</span>
              </h1>
              <p className="text-[10px] tracking-[0.22em] text-slate-500">
                VOICE DESK
              </p>
            </div>
          </a>

          <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2 text-xs font-medium text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
            AI SYSTEM ONLINE
          </div>
        </nav>
      </header>

      {/* Main content */}
      <section className="relative z-10 mx-auto grid max-w-7xl items-center gap-14 px-5 py-12 md:px-10 md:py-20 lg:grid-cols-[1fr_0.95fr]">

        {/* Hero */}
        <div className="animate-fade-up">

          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-2 text-xs font-medium text-cyan-300">
            <span>✦</span>
            INTELLIGENT INDIAN VOICE AI
          </div>

          <h2 className="mt-8 text-5xl font-bold leading-[1.12] tracking-tight sm:text-6xl lg:text-7xl">
            Your Voice.
            <br />
            Your Language.
            <br />
            <span className="bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400 bg-clip-text text-transparent">
              Your AI.
            </span>
          </h2>

          <p className="mt-7 max-w-xl text-base leading-8 text-slate-400 md:text-lg">
            Experience a smarter way to communicate. Speak naturally
            in Indian languages and let AI understand, think and
            respond with a human-like voice.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-4">
              <p className="text-lg font-bold text-white">01</p>
              <p className="mt-1 text-xs text-slate-400">Speak naturally</p>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-4">
              <p className="text-lg font-bold text-white">02</p>
              <p className="mt-1 text-xs text-slate-400">AI understands</p>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-4">
              <p className="text-lg font-bold text-white">03</p>
              <p className="mt-1 text-xs text-slate-400">Hear the answer</p>
            </div>
          </div>

          {/* Technology */}
          <div className="mt-12 border-t border-white/[0.08] pt-8">
            <p className="text-[10px] font-semibold tracking-[0.25em] text-slate-500">
              POWERED BY ADVANCED AI TECHNOLOGY
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-8">
              <div>
                <p className="text-xl font-bold">Prisma</p>
                <p className="mt-1 text-xs text-slate-500">Speech recognition</p>
              </div>

              <div className="h-9 w-px bg-white/10" />

              <div>
                <p className="text-xl font-bold">Gemini</p>
                <p className="mt-1 text-xs text-slate-500">AI intelligence</p>
              </div>

              <div className="h-9 w-px bg-white/10" />

              <div>
                <p className="text-xl font-bold">Timbre</p>
                <p className="mt-1 text-xs text-slate-500">Voice generation</p>
              </div>
            </div>
          </div>
        </div>

        {/* Voice assistant */}
        <div className="animate-fade-up">
          <div className="glass-panel glow-cyan rounded-[28px] p-5 sm:p-8">

            {/* Card header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-cyan-300">
                  BHARAT VOICE DESK
                </p>
                <h3 className="mt-2 text-2xl font-bold tracking-tight">
                  Voice Assistant
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  Your personal AI conversation space
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                v1.0
              </div>
            </div>

            {/* Microphone */}
            <div className="flex flex-col items-center py-9">
              <div className={`relative flex h-48 w-48 items-center justify-center rounded-full border transition-all duration-500 ${
                recording
                  ? "border-red-400/50 bg-red-400/[0.06]"
                  : "border-cyan-400/20 bg-cyan-400/[0.04]"
              }`}>
                <div className={`absolute inset-3 rounded-full border ${
                  recording ? "border-red-400/20" : "border-cyan-400/10"
                }`} />

                <div className={`voice-orb relative flex h-32 w-32 items-center justify-center rounded-full text-5xl shadow-2xl transition-all duration-300 ${
                  recording
                    ? "recording bg-gradient-to-br from-red-400 to-rose-600 shadow-red-500/30"
                    : "bg-gradient-to-br from-cyan-300 to-blue-500 shadow-cyan-500/30"
                }`}>
                  <span>🎙️</span>
                </div>
              </div>

              <p className="mt-7 text-lg font-semibold">
                {recording
                  ? "I'm listening..."
                  : loading
                  ? "Processing your voice..."
                  : status}
              </p>

              <p className="mt-2 text-center text-xs text-slate-500">
                {recording
                  ? "Speak clearly. Press stop when finished."
                  : loading
                  ? "Please wait while your AI response is prepared."
                  : "Select your language and start a conversation."}
              </p>

              {/* Sound wave decoration */}
              <div className="mt-5 flex h-7 items-center gap-1">
                {[12, 20, 27, 15, 23, 30, 17, 25, 13, 21, 28, 15, 23, 12].map(
                  (height, index) => (
                    <span
                      key={index}
                      className={`w-1 rounded-full transition-all ${
                        recording
                          ? "animate-pulse bg-red-400"
                          : "bg-cyan-400/40"
                      }`}
                      style={{ height: `${height}px` }}
                    />
                  )
                )}
              </div>
            </div>

            {/* Language selector */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold tracking-wider text-slate-400">
                  CONVERSATION LANGUAGE
                </label>
                <span className="text-[10px] text-slate-500">3 LANGUAGES</span>
              </div>

              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                disabled={isBusy}
                className="w-full rounded-xl border border-white/10 bg-[#090d1b] px-4 py-4 text-sm text-white outline-none transition focus:border-cyan-400/50 disabled:opacity-50"
              >
                <option value="Hindi">🇮🇳 Hindi</option>
                <option value="English">🇬🇧 English</option>
                <option value="Marathi">🇮🇳 Marathi</option>
              </select>
            </div>

            {/* Recording button */}
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={loading}
              className={`mt-5 flex w-full items-center justify-center gap-3 rounded-xl py-4 font-bold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                recording
                  ? "bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/20 hover:brightness-110"
                  : "bg-gradient-to-r from-cyan-300 to-sky-400 text-[#07101d] shadow-lg shadow-cyan-500/20 hover:-translate-y-0.5 hover:brightness-110"
              }`}
            >
              <span className="text-lg">{recording ? "■" : "🎙"}</span>
              {recording
                ? "Stop Recording"
                : loading
                ? "Processing..."
                : "Start Speaking"}
            </button>

            {error && (
              <div className="mt-5 rounded-xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-300">
                <p className="font-semibold">Something needs attention</p>
                <p className="mt-1">{error}</p>
              </div>
            )}

            {/* Original recording */}
            {recordingUrl && (
              <div className="animate-fade-up mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="mb-3 text-xs font-semibold tracking-wider text-slate-400">
                  YOUR RECORDING
                </p>
                <audio controls src={recordingUrl} />
              </div>
            )}

            {/* Transcription */}
            {transcript && (
              <div className="animate-fade-up mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.045] p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold tracking-wider text-cyan-300">
                    <span className="mr-2">✦</span>
                    SPEECH TRANSCRIPTION
                  </p>
                  <button
                    onClick={() => navigator.clipboard.writeText(transcript)}
                    className="text-xs text-cyan-300 hover:text-white"
                  >
                    Copy
                  </button>
                </div>

                <p className="mt-4 text-base leading-8 text-slate-100">
                  {transcript}
                </p>
                <p className="mt-3 text-[10px] text-slate-500">
                  Powered by Gnani Prisma
                </p>
              </div>
            )}

            {/* AI answer */}
            {aiAnswer && (
              <div className="animate-fade-up mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.045] p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold tracking-wider text-violet-300">
                    <span className="mr-2">✦</span>
                    GEMINI AI RESPONSE
                  </p>
                  <button
                    onClick={() => navigator.clipboard.writeText(aiAnswer)}
                    className="text-xs text-violet-300 hover:text-white"
                  >
                    Copy
                  </button>
                </div>

                <p className="mt-4 whitespace-pre-wrap text-base leading-8 text-slate-100">
                  {aiAnswer}
                </p>
                <p className="mt-3 text-[10px] text-slate-500">
                  Generated by Gemini AI
                </p>
              </div>
            )}

            {/* Generated voice */}
            {speechUrl && (
              <div className="animate-fade-up mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.045] p-5">
                <p className="text-xs font-bold tracking-wider text-emerald-300">
                  <span className="mr-2">♫</span>
                  YOUR AI VOICE RESPONSE
                </p>

                <audio
                  ref={audioRef}
                  controls
                  src={speechUrl}
                  className="mt-4"
                />

                <button
                  onClick={() => audioRef.current?.play()}
                  className="mt-4 w-full rounded-xl border border-emerald-400/20 bg-emerald-400/10 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400/20"
                >
                  ▶ Play AI Voice
                </button>

                <p className="mt-3 text-center text-[10px] text-slate-500">
                  Generated by Gnani Timbre
                </p>
              </div>
            )}

            {/* Clear */}
            <button
              onClick={clearAll}
              disabled={isBusy}
              className="mt-5 w-full rounded-lg py-3 text-xs font-medium text-slate-500 transition hover:text-white disabled:opacity-40"
            >
              ↻ Clear conversation
            </button>

            <div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Secure AI-powered voice experience
            </div>
          </div>
        </div>
      </section>

      {/* Technology section */}
      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-20 pt-8 md:px-10">
        <div className="border-t border-white/[0.07] pt-14">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-[0.25em] text-cyan-300">
              THE TECHNOLOGY
            </p>
            <h3 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              Three technologies. One conversation.
            </h3>
            <p className="mt-4 text-sm leading-7 text-slate-400">
              A complete voice intelligence pipeline that transforms
              natural speech into meaningful AI conversations.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                number: "01",
                icon: "🎤",
                name: "Gnani Prisma",
                type: "SPEECH TO TEXT",
                description:
                  "Recognizes your spoken words and converts them into text.",
                color: "text-cyan-300",
              },
              {
                number: "02",
                icon: "🧠",
                name: "Gemini AI",
                type: "INTELLIGENCE",
                description:
                  "Understands your message and creates a relevant response.",
                color: "text-violet-300",
              },
              {
                number: "03",
                icon: "🔊",
                name: "Gnani Timbre",
                type: "TEXT TO SPEECH",
                description:
                  "Turns the AI-generated answer into spoken audio.",
                color: "text-emerald-300",
              },
            ].map((item) => (
              <div
                key={item.number}
                className="glass-panel rounded-2xl p-7 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/20"
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl">{item.icon}</span>
                  <span className="text-xs tracking-widest text-slate-600">
                    {item.number}
                  </span>
                </div>

                <p className={`mt-7 text-[10px] font-bold tracking-[0.2em] ${item.color}`}>
                  {item.type}
                </p>
                <h4 className="mt-2 text-xl font-bold">{item.name}</h4>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 text-center sm:flex-row sm:px-10 sm:text-left">
          <div>
            <p className="font-bold">
              Bharat<span className="text-cyan-400">Voice</span> Desk
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Intelligent voice conversations for India.
            </p>
          </div>

          <p className="text-xs text-slate-500">
            © 2026 Bharat Voice Desk. Built with AI.
          </p>
        </div>
      </footer>
    </main>
  );
}
