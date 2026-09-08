import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { queryDocument, getChatHistory } from "../api/chat";

// Async thunk: send a question, get an answer back
export const sendQuestion = createAsyncThunk(
  "chat/sendQuestion",
  async ({ question, chatId }) => {
    const response = await queryDocument(question, chatId);
    return response;
  }
);

export const fetchChatHistory = createAsyncThunk(
  "chat/fetchChatHistory",
  async () => {
    const response = await getChatHistory();
    return response;
  }
);

const chatSlice = createSlice({
  name: "chat",
  initialState: {
    messages: [],       // messages in the currently open chat
    history: [],         // list of past chats (sidebar)
    activeChatId: null,
    status: "idle",       // idle | loading | failed
    error: null,
  },
  reducers: {
    addUserMessage: (state, action) => {
      state.messages.push({
        role: "user",
        content: action.payload,
        timestamp: new Date().toISOString(),
      });
    },
    startNewChat: (state) => {
      state.messages = [];
      state.activeChatId = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sendQuestion.pending, (state) => {
        state.status = "loading";
      })
      .addCase(sendQuestion.fulfilled, (state, action) => {
        state.status = "idle";
        state.activeChatId = action.payload.chatId;
        state.messages.push({
          role: "assistant",
          content: action.payload.answer,
          sources: action.payload.sources,
          timestamp: action.payload.timestamp,
        });
      })
      .addCase(sendQuestion.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      .addCase(fetchChatHistory.fulfilled, (state, action) => {
        state.history = action.payload;
      });
  },
});

export const { addUserMessage, startNewChat } = chatSlice.actions;
export default chatSlice.reducer;
