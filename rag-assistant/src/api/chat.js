import api from "./axiosInstance";
// Send a question/query to the backend RAG endpoint
export const queryDocument = async (question, chatId) => {
  const res = await api.post("/chat/query", { question, chatId });
  return res.data;
};
// Get all chat sessions for the sidebar
export const getChatHistory = async () => {
  const res = await api.get("/chat/sessions");
  return res.data.chats;
};
// Get all messages for a specific chat session
export const getChatMessages = async (chatId) => {
  const res = await api.get(`/chat/${chatId}/messages`);
  return res.data.messages;
};
// Create a new blank chat session
export const createNewChat = async () => {
  const res = await api.post("/chat/new");
  return res.data.chat;
};
// Delete a chat session by ID
export const deleteChat = async (chatId) => {
  const res = await api.delete(`/chat/${chatId}`);
  return res.data;
};