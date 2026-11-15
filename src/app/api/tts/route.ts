
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { text, language } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { success: false, error: "Text is required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GNANI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Gnani API key is missing." },
        { status: 500 }
      );
    }

    const voices: Record<string, { code: string; voice: string }> = {
      Hindi: { code: "hi-IN", voice: "Nalini" },
      English: { code: "en-IN", voice: "Yashvi" },
      Marathi: { code: "mr-IN", voice: "Zahira" },
    };

    const selected = voices[language] || voices.Hindi;

    const response = await fetch(
      "https://api.vachana.ai/api/v1/tts/inference",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key-ID": apiKey,
        },
        body: JSON.stringify({
          text,
          model: "timbre-v2.5",
          voice: selected.voice,
          language: selected.code,
          speed: 1.0,
          audio_config: {
            sample_rate: 24000,
            num_channels: 1,
            sample_width: 2,
            encoding: "linear_pcm",
            container: "wav",
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gnani TTS error:", errorText);

      return NextResponse.json(
        {
          success: false,
          error: `Timbre API error (${response.status}): ${errorText}`,
        },
        { status: response.status }
      );
    }

    const audio = await response.arrayBuffer();

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("TTS route error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Unable to generate speech.",
      },
      { status: 500 }
    );
  }
}
