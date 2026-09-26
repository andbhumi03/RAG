import React, { useState, useRef, useEffect } from 'react';
import { Send, Upload, FileText, Loader2, Bot, User } from 'lucide-react';

export default function RagAssistant() {
    const [messages, setMessages] = useState([
        { sender: 'bot', text: 'Hello! Upload a document or ask a question about your files.' }
    ]);
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isQuerying, setIsQuerying] = useState(false);
    const [uploadStatus, setUploadStatus] = useState('');

    const chatEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const baseApi = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/$/, "");
    const API_BASE = `${baseApi}/docs`;

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isQuerying]);
    // Handle Document Upload (POST /api/docs/upload)
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUploading(true);
        setUploadStatus(`Uploading ${file.name}...`);
        const formData = new FormData();
        formData.append('file', file);
        const token = localStorage.getItem('token');
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        try {
            const res = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                headers,
                body: formData,
            });
            const data = await res.json();
            if (res.ok) {
                setUploadStatus(`Uploaded: ${file.name}`);
                setMessages((prev) => [
                    ...prev,
                    {
                        sender: 'bot',
                        text: `Document "${file.name}" successfully ingested! You can now ask questions about it.`
                    }
                ]);
            } else {
                setUploadStatus('Upload failed');
                alert(data.error || 'Failed to upload document');
            }
        } catch (err) {
            console.error(err);
            setUploadStatus('Upload error');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Handle Query Submission (POST /api/docs/query)
    const handleSendQuery = async (e) => {
        e.preventDefault();
        if (!input.trim() || isQuerying) return;

        const userQuery = input.trim();
        setInput('');

        // Add User Message
        setMessages((prev) => [...prev, { sender: 'user', text: userQuery }]);
        setIsQuerying(true);

        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const res = await fetch(`${API_BASE}/query`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ query: userQuery }),
            });
            const data = await res.json();
            if (res.ok) {
                setMessages((prev) => [
                    ...prev,
                    {
                        sender: 'bot',
                        text: data.answer,
                        sources: data.sources || []
                    }
                ]);
            } else {
                setMessages((prev) => [
                    ...prev,
                    { sender: 'bot', text: `Error: ${data.error || 'Could not fetch answer.'}` }
                ]);
            }
        } catch (err) {
            console.error(err);
            setMessages((prev) => [
                ...prev,
                { sender: 'bot', text: 'Failed to connect to the backend server.' }
            ]);
        } finally {
            setIsQuerying(false);
        }
    };
    return (
        <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 bg-gray-50">
            {/* Header & File Upload */}
            <div className="flex items-center justify-between p-4 bg-white rounded-lg shadow mb-4">
                <div>
                    <h1 className="text-xl font-bold text-gray-800">RAG Knowledge Assistant</h1>
                    <p className="text-xs text-gray-500">Ask questions grounded in your uploaded documents</p>
                </div>

                <div className="flex items-center gap-3">
                    {uploadStatus && <span className="text-xs text-gray-600">{uploadStatus}</span>}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept=".txt,.pdf"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
                    >
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        Upload Doc
                    </button>
                </div>
            </div>

            {/* Chat Output Area */}
            <div className="flex-1 overflow-y-auto p-4 bg-white rounded-lg shadow space-y-4">
                {messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={`flex items-start gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''
                            }`}
                    >
                        <div
                            className={`p-2 rounded-full text-white ${msg.sender === 'user' ? 'bg-blue-600' : 'bg-gray-700'
                                }`}
                        >
                            {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                        </div>

                        <div
                            className={`max-w-[75%] p-3 rounded-xl text-sm ${msg.sender === 'user'
                                ? 'bg-blue-600 text-white rounded-tr-none'
                                : 'bg-gray-100 text-gray-800 rounded-tl-none'
                                }`}
                        >
                            <p className="whitespace-pre-wrap">{msg.text}</p>
                            {msg.sources && msg.sources.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500 flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    <span>Sources: {msg.sources.map(s => typeof s === 'string' ? s : s.fileName).join(', ')}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {isQuerying && (
                    <div className="flex items-center gap-2 text-gray-500 text-sm italic">
                        <Loader2 className="w-4 h-4 animate-spin" /> Searching knowledge base...
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>
            {/* Input Form */}
            <form onSubmit={handleSendQuery} className="mt-4 flex gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a question about your documents..."
                    disabled={isQuerying}
                    className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                />
                <button
                    type="submit"
                    disabled={isQuerying || !input.trim()}
                    className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition"
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
        </div>
    );
}