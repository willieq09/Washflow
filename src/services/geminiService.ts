import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface ScanResult {
  plate: string;
  vehicle: string;
  tirePressure?: string;
  dirtLevel?: 'low' | 'medium' | 'high';
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
          text: "Carefully analyze this vehicle image. Identify the license plate number (including characters and numbers) and the vehicle brand, model, and year if possible. Also, estimate the tire pressure status (e.g., 'Normal', 'Appear Low') and the visual dirt level (low, medium, or high). Be extremely precise. If you cannot find a plate, return an empty string for it. Return the result in JSON format."
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            plate: { type: Type.STRING, description: "The license plate number identified from the image" },
            vehicle: { type: Type.STRING, description: "The vehicle brand, model, and year" },
            tirePressure: { type: Type.STRING, description: "Estimated tire pressure status" },
            dirtLevel: { type: Type.STRING, enum: ["low", "medium", "high"], description: "Visual dirt level on the exterior" }
          },
          required: ["plate", "vehicle", "tirePressure", "dirtLevel"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return {
      plate: result.plate || "",
      vehicle: result.vehicle || "",
      tirePressure: result.tirePressure || "Unknown",
      dirtLevel: result.dirtLevel || "low"
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

export async function getPredictiveTips(vehicleInfo: { make: string, model: string, year: number | string }, washHistoryCount: number) {
  if (!process.env.GEMINI_API_KEY) return { nextWash: "Keep a regular schedule.", maintenance: "Check your essentials." };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `User vehicle: ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}. 
      Frequency: ${washHistoryCount} washes this month. 
      Generate 2 insights:
      1. Predicting the next ideal wash day based on high-frequency usage (people wash cars multiple times weekly).
      2. A maintenance suggestion specific to this car type.
      Return JSON with keys "nextWash" and "maintenance".`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            nextWash: { type: Type.STRING },
            maintenance: { type: Type.STRING }
          },
          required: ["nextWash", "maintenance"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini Predictive Error:", error);
    return { nextWash: "Wash every 3-4 days for peak shine.", maintenance: "Wax frequently to protect paint." };
  }
}

export async function generateAnalyticsReport(stats: any, recentWashes: any[]) {
  if (!process.env.GEMINI_API_KEY) return "AI analytics is currently unavailable. Please check back later.";

  try {
    const washSummary = recentWashes.map(w => `${w.carModel} (${w.price})`).join(", ");
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Context: Car Wash SaaS Dashboard.
      Today's Revenue: ${stats.todayRevenue}
      Today's Volume: ${stats.todayCount}
      Recent Activities: ${washSummary}
      
      Task: Provide a high-level performance summary and 2 actionable business insights to help the owner scale. 
      Format: Professional, motivational, and concise. Use bullet points for insights.`,
      config: {
        systemInstruction: "You are a business intelligence agent for a car wash SaaS. Your reports are concise, professional, and data-driven.",
      }
    });

    return response.text || "Your business is currently performing within normal parameters. Continue monitoring volume trends.";
  } catch (error) {
    console.error("Gemini Analytics Error:", error);
    return "Failed to generate report. Your wash volume is steady, but ensure worker incentives are applied to keep performance high.";
  }
}

export async function getWeatherOptimizedSchedule(vehicle: any, weatherInfo: string, lastWashDays: number) {
  if (!process.env.GEMINI_API_KEY) {
    return {
      suggestion: "Maintain a weekly wash schedule.",
      reasoning: "Regular maintenance is key.",
      optimalDay: "Saturday"
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.intensity} usage).
      Last Wash: ${lastWashDays} days ago.
      Weather Forecast: ${weatherInfo}
      
      Task: Suggest the optimal next day for a car wash this week. 
      Consider: If it's going to rain, suggest washing AFTER the rain. If it's sunny, suggest washing sooner. 
      Return JSON with keys: "suggestion", "reasoning", "optimalDay".`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestion: { type: Type.STRING },
            reasoning: { type: Type.STRING },
            optimalDay: { type: Type.STRING }
          },
          required: ["suggestion", "reasoning", "optimalDay"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini Weather Schedule Error:", error);
    return {
      suggestion: "Schedule for the upcoming weekend.",
      reasoning: "Standard maintenance window.",
      optimalDay: "Saturday"
    };
  }
}
