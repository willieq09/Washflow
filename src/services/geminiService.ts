import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function getMaintenanceTip(carModel: string) {
  if (!process.env.GEMINI_API_KEY) return "Regular washing keeps your car looking great!";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Give a brief (1 sentence), professional car maintenance tip for a ${carModel}. Make it advice about when to next wash or service based on common usage.`,
      config: {
        systemInstruction: "You are an expert car maintenance advisor. Your tips should be helpful and concise.",
      }
    });

    return response.text || "Ensure regular checks on tire pressure and fluid levels.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Check your owner's manual for specific maintenance schedules.";
  }
}
