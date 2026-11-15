
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { transcript, language } = await request.json();

    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json(
        { success: false, error: "Transcript is required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Gemini API key is missing." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const languageName =
      language === "Hindi"
        ? "Hindi"
        : language === "Marathi"
        ? "Marathi"
        : "English";

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: transcript,
      config: {
        systemInstruction: `You are Bharat Voice Desk, a helpful Indian voice assistant. Reply in ${languageName}. Give direct, accurate and friendly answers in 2 to 4 sentences. Avoid unnecessary introductions.`,
      },
    });

    return NextResponse.json({
      success: true,
      answer: response.text ?? "Sorry, I could not generate an answer.",
    });

  } catch (error) {
    console.error("Gemini API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Failed to generate an AI response.",
      },
      { status: 500 }
    );
  }
}
