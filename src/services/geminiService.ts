import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface ScanResult {
  plate: string;
  vehicle: string;
}

export async function scanVehicleInfo(base64Image: string): Promise<ScanResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Image
          }
        },
        {
          text: "Identify the vehicle license plate number and the vehicle brand/model from this image. Return the result in JSON format."
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            plate: { type: Type.STRING, description: "The license plate number" },
            vehicle: { type: Type.STRING, description: "The vehicle brand and model" }
          },
          required: ["plate", "vehicle"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return {
      plate: result.plate || "",
      vehicle: result.vehicle || ""
    };
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    throw error;
  }
}
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
