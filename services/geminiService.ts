import { GoogleGenAI, Type } from "@google/genai";
import { DocumentFile, Flashcard, QuizQuestion, StudyTask, ExamPaper } from "../types";

const apiKey = process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey });

// Helper to construct contents based on file type
const getFileContentPart = (doc: DocumentFile) => {
  if (doc.inlineData) {
    return {
      inlineData: {
        data: doc.inlineData.data,
        mimeType: doc.inlineData.mimeType
      }
    };
  }
  return { text: doc.content };
};

export const generateSummary = async (doc: DocumentFile): Promise<string> => {
  try {
    const filePart = getFileContentPart(doc);
    const promptPart = { text: "Please provide a concise summary (max 3 paragraphs) of the this document. Focus on the key concepts and main arguments." };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [filePart, promptPart]
      },
    });
    return response.text || "Unable to generate summary.";
  } catch (error) {
    console.error("Error generating summary:", error);
    return "Summary generation failed. Ensure the file type is supported.";
  }
};

export const chatWithDocument = async (
  history: { role: string; parts: { text: string }[] }[],
  doc: DocumentFile,
  message: string
): Promise<string> => {
  try {
    const systemInstruction = `You are MindAI, an intelligent student assistant. 
    Answer the user's questions strictly based on the provided document. 
    If the answer is not in the document, politely say so.`;

    let finalHistory: { role: string; parts: any[] }[] = history.map(h => ({ role: h.role, parts: h.parts }));
    
    const chatConfig: any = {
      model: "gemini-2.5-flash",
      config: { systemInstruction },
    };

    if (doc.inlineData && finalHistory.length === 0) {
       // Initialize with file
       finalHistory = [{
         role: 'user',
         parts: [
            getFileContentPart(doc),
            { text: "Analyze this document and prepare to answer questions." }
         ]
       }, {
         role: 'model',
         parts: [{ text: "I have analyzed the document. What would you like to know?" }]
       }];
    } else if (!doc.inlineData) {
        chatConfig.config.systemInstruction += `\n\nDOCUMENT CONTEXT:\n${doc.content.slice(0, 500000)}`;
    }

    const chat = ai.chats.create({
      ...chatConfig,
      history: finalHistory,
    });

    const response = await chat.sendMessage({ message });
    return response.text || "I couldn't generate a response.";
  } catch (error) {
    console.error("Error in chat:", error);
    throw error;
  }
};

export const chatWithKnowledgeBase = async (
  history: { role: string; parts: { text: string }[] }[],
  docs: DocumentFile[],
  message: string
): Promise<string> => {
  try {
    const systemInstruction = `You are MindAI, a Knowledge Base Assistant. 
    You have access to multiple documents. Answer the user's questions by synthesizing information from ALL available documents.
    Cite the document title when referring to specific information.`;

    let finalHistory: { role: string; parts: any[] }[] = history.map(h => ({ role: h.role, parts: h.parts }));

    // Initialize with all files if it's the first turn
    if (finalHistory.length === 0) {
      const fileParts = docs.map(d => getFileContentPart(d));
      // Add a text part to explain what these files are
      fileParts.push({ text: `Here are the documents in the knowledge base: ${docs.map(d => d.title).join(', ')}. Analyze them.` } as any);

      finalHistory = [{
        role: 'user',
        parts: fileParts
      }, {
        role: 'model',
        parts: [{ text: "I have analyzed your knowledge base. I am ready to answer questions across all documents." }]
      }];
    }

    const chat = ai.chats.create({
      model: "gemini-2.5-flash",
      config: { systemInstruction },
      history: finalHistory,
    });

    const response = await chat.sendMessage({ message });
    return response.text || "I couldn't generate a response.";
  } catch (error) {
    console.error("Error in knowledge base chat:", error);
    throw error;
  }
};

export const generateFlashcards = async (doc: DocumentFile, count: number = 10): Promise<Flashcard[]> => {
  try {
    const filePart = getFileContentPart(doc);
    const promptPart = { text: `Create ${count} high-quality study flashcards from this document. The front should be a concept or question, and the back should be the definition or answer.` };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [filePart, promptPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              front: { type: Type.STRING },
              back: { type: Type.STRING },
            },
            required: ["front", "back"],
          },
        },
      },
    });

    const jsonText = response.text || "[]";
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Error generating flashcards:", error);
    return [];
  }
};

export const generateQuiz = async (doc: DocumentFile, count: number = 5): Promise<QuizQuestion[]> => {
  try {
    const filePart = getFileContentPart(doc);
    const promptPart = { text: `Create a multiple-choice quiz with ${count} questions based on the provided document. 
    For each question, provide:
    1. The question text.
    2. 4 distinct options.
    3. The index of the correct answer (0-3).
    4. A detailed explanation. This explanation must:
       - Explain clearly why the correct answer is correct.
       - Mention specific context, sections, or quotes from the document that support the answer (e.g., "As stated in the 'History' section...", "The document explicitly mentions that...").
       - If applicable, briefly explain why common distractors are incorrect.` };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [filePart, promptPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING } 
              },
              correctAnswerIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING }
            },
            required: ["question", "options", "correctAnswerIndex", "explanation"],
          },
        },
      },
    });

    const jsonText = response.text || "[]";
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Error generating quiz:", error);
    return [];
  }
};

export const generateStudyPlan = async (doc: DocumentFile, days: number = 5): Promise<StudyTask[]> => {
  try {
    const filePart = getFileContentPart(doc);
    const promptPart = { text: `Create a ${days}-day study plan to master the content of this document. 
    Break it down into logical sections. For each day, provide a main topic, a list of specific tasks (reading, reviewing, practicing), and estimated time in minutes.` };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [filePart, promptPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              day: { type: Type.INTEGER },
              topic: { type: Type.STRING },
              tasks: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              estimatedMinutes: { type: Type.INTEGER }
            },
            required: ["day", "topic", "tasks", "estimatedMinutes"],
          },
        },
      },
    });

    const jsonText = response.text || "[]";
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Error generating study plan:", error);
    return [];
  }
};

export const generateMindMap = async (doc: DocumentFile): Promise<string> => {
  try {
    const filePart = getFileContentPart(doc);
    const promptPart = { text: `Create a mind map using Mermaid.js syntax that represents the key concepts and hierarchy of this document.
    Return ONLY the Mermaid code starting with 'mindmap'. Do not include markdown code blocks or explanations.` };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [filePart, promptPart] },
    });

    let text = response.text || "";
    // Clean up potential markdown code blocks
    text = text.replace(/```mermaid/g, '').replace(/```/g, '').trim();
    return text;
  } catch (error) {
    console.error("Error generating mind map:", error);
    return "";
  }
};

export const generateExamPaper = async (
    doc: DocumentFile, 
    numQuestions: number, 
    difficulty: string, 
    type: string
): Promise<ExamPaper | null> => {
    try {
      const filePart = getFileContentPart(doc);
      const promptPart = { text: `Create a formal exam paper based on this document.
      Configuration:
      - Number of Questions: ${numQuestions}
      - Difficulty: ${difficulty}
      - Question Type: ${type} (If 'mixed', include both short and long answer questions).
      
      Provide the output as a JSON object containing:
      1. An exam title (e.g., "Mid-Term Examination: [Subject]").
      2. Suggested total marks and duration.
      3. A list of questions. Each question must have:
         - The question text.
         - Suggested marks (e.g., 2, 5, 10).
         - Type ('short' or 'long').
         - A detailed Answer Key/Model Answer for the teacher.` };
  
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [filePart, promptPart] },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              totalMarks: { type: Type.INTEGER },
              durationMinutes: { type: Type.INTEGER },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    question: { type: Type.STRING },
                    marks: { type: Type.INTEGER },
                    type: { type: Type.STRING, enum: ['short', 'long'] },
                    answerKey: { type: Type.STRING }
                  }
                }
              }
            }
          },
        },
      });
  
      const jsonText = response.text;
      return jsonText ? JSON.parse(jsonText) : null;
    } catch (error) {
      console.error("Error generating exam paper:", error);
      return null;
    }
  };