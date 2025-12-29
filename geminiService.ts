
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ResumeAnalysisResult, AnswerEvaluation } from "./types";

// Supports both standard API_KEY and the user's custom Vercel key name
const apiKey = process.env.API_KEY || (process.env as any).telawneInterviewAi || '';
const ai = new GoogleGenAI({ apiKey });

export const analyzeResume = async (base64Data: string, mimeType: string, jd: string): Promise<ResumeAnalysisResult | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          },
          {
            text: `Job Description for Telawne Transformer Company:\n${jd}\n\nTask: Analyze the attached resume against this Job Description. Provide a score from 0 to 100. Only recommend 'shortlist' if the score is 40 or higher.`
          }
        ]
      },
      config: {
        systemInstruction: "You are a world-class HR Recruiting AI for Telawne Transformer Company. Provide a structured JSON response.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            skills: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING },
            recommendation: { type: Type.STRING, enum: ["shortlist", "reject"] },
          },
          required: ["score", "skills", "summary", "recommendation"]
        },
      },
    });
    return JSON.parse(response.text || '{}') as ResumeAnalysisResult;
  } catch (error) {
    console.error("Resume Analysis Error:", error);
    return null;
  }
};

export const generateInterviewQuestions = async (
  round: number, 
  position: string, 
  jd: string, 
  candidateSummary: string
): Promise<string[]> => {
  try {
    const prompt = round === 1 
      ? `Generate 5 behavioral and introductory questions for a ${position} candidate.`
      : `Generate 5 deep technical questions for a ${position} role based on: ${jd}.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "You are an AI Interviewer for Telawne Transformer Company. Generate a list of exactly 5 questions.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });
    return JSON.parse(response.text || '[]') as string[];
  } catch (error) {
    return ["Tell me about yourself.", "Why Telawne?", "What are your strengths?", "Describe a challenge you faced.", "Where do you see yourself in 5 years?"];
  }
};

export const evaluateAudioAnswer = async (question: string, audioBase64: string, mimeType: string): Promise<AnswerEvaluation> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: audioBase64, mimeType: mimeType } },
          { text: `Question was: "${question}"\n\nTask: Evaluate the candidate's response. \n1. Transcribe the audio precisely.\n2. If the audio is silent, too short, or just noise, set the score to 0 and confidence to 0.\n3. If it's a valid answer, score Content (0-10) and Confidence (0-10).` }
        ]
      },
      config: {
        systemInstruction: "You are an expert technical interviewer for Telawne Transformer Company. Be strict. If the candidate provides no meaningful answer or the audio is empty, give a score of 0. Otherwise, evaluate technical depth and vocal confidence.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER, description: "Content accuracy score (0-10). Silent/Empty = 0." },
            confidence: { type: Type.NUMBER, description: "Vocal confidence score (0-10). Silent/Empty = 0." },
            transcript: { type: Type.STRING, description: "The literal transcription of what was said." },
            feedback: { type: Type.STRING, description: "Short feedback." }
          },
          required: ["score", "confidence", "transcript", "feedback"]
        }
      }
    });
    return JSON.parse(response.text || '{}') as AnswerEvaluation;
  } catch (error) {
    console.error("Evaluation Error:", error);
    return { score: 0, confidence: 0, transcript: "Error processing audio.", feedback: "Could not analyze response." };
  }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say professionally: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    return null;
  }
};
