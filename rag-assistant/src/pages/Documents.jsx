import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserDocuments, deleteDocument, uploadDocument, getDocumentChunks } from '../api/documents';
import Layout from '../components/Layout';

// Consolidated Loader Spinner component
const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-5 w-5 border-2 border-[#a8c7fa] border-t-[#1a73e8] shrink-0" />
);

export default function Documents() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lastUploadedDoc, setLastUploadedDoc] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Chunks inspector states
  const [inspectingDocId, setInspectingDocId] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  useEffect(() => {
    loadDocuments();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 3000);
  };

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const docs = await getUserDocuments();
      setDocuments(docs || []);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      alert("File size exceeds 10MB limit.");
      return;
    }

    // Check file format
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
      alert("Unsupported file format. Please upload PDF, DOCX, or TXT.");
      return;
    }

    setUploading(true);
    try {
      const res = await uploadDocument(file);
      // Immediate insertion into document table
      if (res) {
        const newDoc = {
          _id: res.documentId,
          fileName: res.fileName,
          status: res.status,
          chunkCount: res.totalChunks || res.chunkCount || 0,
          createdAt: res.uploadDate || new Date().toISOString()
        };
        setDocuments((prev) => [newDoc, ...prev]);
        setLastUploadedDoc(file.name);
        showToast(`Document "${file.name}" indexed successfully!`);
      } else {
        await loadDocuments();
        setLastUploadedDoc(file.name);
        showToast("Document uploaded.");
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert(err.response?.data?.error || "Failed to upload document. Ensure file is not scanned and is readable.");
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Are you sure you want to delete this document? All associated vector embeddings will be permanently removed.')) {
      return;
    }

    try {
      setDeletingId(docId);
      await deleteDocument(docId);
      setDocuments((prev) => prev.filter((doc) => doc._id !== docId));
      showToast("Document deleted successfully");
      if (inspectingDocId === docId) {
        setInspectingDocId(null);
        setChunks([]);
      }
    } catch (err) {
      console.error('Failed to delete document:', err);
      alert('Failed to delete document. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleInspectChunks = async (docId) => {
    if (inspectingDocId === docId) {
      setInspectingDocId(null);
      setChunks([]);
      return;
    }

    setInspectingDocId(docId);
    setLoadingChunks(true);
    setChunks([]);

    try {
      const data = await getDocumentChunks(docId);
      setChunks(data || []);
    } catch (err) {
      console.error("Failed to load document chunks:", err);
      showToast("Failed to load chunks details", "error");
    } finally {
      setLoadingChunks(false);
    }
  };

  const copyToClipboard = (text, message = "Copied to clipboard!") => {
    navigator.clipboard.writeText(text);
    showToast(message);
  };

  return (
    <Layout hideSidebar={true}>
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white relative">

        {/* Scroll Locked Dashboard Container */}
        <div className="flex-1 flex flex-col overflow-hidden max-w-6xl w-full mx-auto px-6 py-6">

          {/* Header Block */}
          <div className="mb-6 flex items-center justify-between border-b border-[#e3e8ef] pb-4 shrink-0">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1a73e8] mb-1 block">
                Knowledge Resource
              </span>
              <h1 className="text-xl font-black text-[#1f1f1f] tracking-tight">
                Documents Base
              </h1>
            </div>
            <button
              type="button"
              onClick={() => navigate("/chat")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a73e8] text-white hover:bg-[#1557b0] text-xs font-bold transition shadow-md cursor-pointer"
              title="Return to Chat section"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>Go to Chat</span>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>

          {/* Post-Ingestion Action Banner */}
          {lastUploadedDoc && (
            <div className="mb-4 bg-[#c2e7ff]/40 border border-[#7fcfff] text-[#001d35] px-4 py-3 rounded-2xl flex items-center justify-between shadow-xs animate-fade-in">
              <div className="flex items-center gap-2.5 text-xs font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span>"{lastUploadedDoc}" is indexed and ready!</span>
              </div>
              <button
                type="button"
                onClick={() => navigate("/chat")}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#004a77] text-white hover:bg-[#003355] text-xs font-bold transition shadow-xs cursor-pointer"
              >
                <span>Ask Questions in Chat</span>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          )}

          {/* Stable Static Alert Notification (Replaced floating popup) */}
          {toast.show && (
            <div className="mb-4 bg-[#f0f4f9] border border-[#a8c7fa] text-[#004a77] font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 shrink-0 transition-all">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {toast.message}
            </div>
          )}

          {/* Drag & Drop Upload Zone */}
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-3xl p-6 text-center transition-all duration-300 mb-6 shrink-0 relative overflow-hidden ${dragActive
                ? "border-sky-500 bg-sky-500/5"
                : "border-[#e3e8ef] bg-[#f0f4f9] hover:border-[#a8c7fa] hover:bg-[#e3e8ef]/60"
              } shadow-xs`}
          >
            <input
              type="file"
              id="documents-upload-main-input"
              className="hidden"
              accept=".pdf,.docx,.txt"
              onChange={handleFileInput}
              disabled={uploading}
            />
            <label
              htmlFor="documents-upload-main-input"
              className={`flex flex-col items-center justify-center cursor-pointer ${uploading ? "pointer-events-none" : ""}`}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <LoadingSpinner />
                  <h3 className="text-sm font-bold text-[#1f1f1f] mt-3">Processing Document...</h3>
                  <p className="text-xs text-[#5f6368] mt-0.5 max-w-xs leading-relaxed">
                    Extracting layout text and compiling vector dimensions in database.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="h-10 w-10 rounded-2xl bg-sky-500/10 text-[#1a73e8] flex items-center justify-center mb-2 shadow-inner">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <h3 className="text-xs font-bold text-[#1f1f1f]">
                    Click to upload or drag & drop
                  </h3>
                  <p className="text-[10px] text-[#5f6368] mt-0.5">
                    Supports PDF, DOCX, or TXT files up to 10MB
                  </p>
                </div>
              )}
            </label>
          </div>

          {/* Documents Table Container */}
          <div className="flex-1 overflow-y-auto min-h-0 bg-[#f0f4f9]/30 rounded-3xl border border-[#e3e8ef]">
            {loading ? (
              <div className="p-10 flex flex-col items-center justify-center">
                <LoadingSpinner />
                <p className="text-[#5f6368] text-xs font-semibold mt-3.5">Fetching indexed workspace...</p>
              </div>
            ) : documents.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center justify-center">
                <div className="h-11 w-11 rounded-2xl bg-white flex items-center justify-center text-[#5f6368] mb-3.5 border border-[#e3e8ef]">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-[#1f1f1f] text-sm font-bold">No documents indexed</h3>
                <p className="text-[#5f6368] text-xs mt-1.5 max-w-sm leading-relaxed">
                  Upload documents using the drop zone above. Once processed, they will appear here and be searchable by the chat assistant.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#f0f4f9] text-[#5f6368] border-b border-[#e3e8ef] font-bold uppercase tracking-wider sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-4">File Name</th>
                      <th className="px-6 py-4">Date Indexed</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e3e8ef] text-[#1f1f1f]">
                    {documents.map((doc) => (
                      <tr key={doc._id} className="hover:bg-[#f0f4f9]/45 transition-colors">
                        <td className="px-6 py-4 font-bold text-[#1f1f1f] flex items-center gap-3">
                          <div className="h-8 w-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-[#1a73e8] shrink-0">
                            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <span className="truncate max-w-xs lg:max-w-md block" title={doc.fileName}>
                            {doc.fileName}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#5f6368]">
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => navigate("/chat")}
                            className="inline-flex items-center gap-1.5 text-[#1a73e8] hover:text-white hover:bg-[#1a73e8] bg-[#c2e7ff]/30 px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer"
                            title="Chat with your documents"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            <span>Chat</span>
                          </button>
                          <button
                            onClick={() => handleDelete(doc._id)}
                            disabled={deletingId === doc._id}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-xl font-bold text-xs transition disabled:opacity-50 cursor-pointer"
                          >
                            {deletingId === doc._id ? (
                              <span>Deleting...</span>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Delete</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}