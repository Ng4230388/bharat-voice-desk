
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Test whether the route is working
export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Bharat Voice Desk transcription API is active.",
  });
}

// Send audio to Gnani Prisma
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GNANI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Gnani API key is missing." },
        { status: 500 }
      );
    }

    const incoming = await request.formData();
    const audio = incoming.get("audio");
    const language = incoming.get("language")?.toString() || "Hindi";

    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json(
        { success: false, error: "Valid audio file is required." },
        { status: 400 }
      );
    }

    const languageCodes: Record<string, string> = {
      Hindi: "hi-IN",
      English: "en-IN",
      Marathi: "mr-IN",
    };

    const form = new FormData();

    form.append("audio_file", audio, "recording.wav");
    form.append("model", "prisma-v3.0");
    form.append("language_code", languageCodes[language] || "hi-IN");
    form.append("format", "transcribe");

    const gnaniResponse = await fetch(
      "https://api.vachana.ai/stt/v3",
      {
        method: "POST",
        headers: {
          "X-API-Key-ID": apiKey,
        },
        body: form,
        cache: "no-store",
      }
    );

    const responseText = await gnaniResponse.text();

    let result;

    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("Gnani returned non-JSON:", responseText);

      return NextResponse.json(
        {
          success: false,
          error: "Gnani returned an unexpected response.",
        },
        { status: 502 }
      );
    }

    if (!gnaniResponse.ok) {
      console.error("Gnani API error:", result);

      return NextResponse.json(
        {
          success: false,
          error: result.message || result.error || "Gnani API request failed.",
        },
        { status: gnaniResponse.status }
      );
    }

    return NextResponse.json({
      success: true,
      transcript: result.transcript || "",
      requestId: result.request_id || null,
    });

  } catch (error) {
    console.error("Backend error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error. Check the VS Code terminal.",
      },
      { status: 500 }
    );
  }
}
