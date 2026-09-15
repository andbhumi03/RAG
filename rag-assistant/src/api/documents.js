import api from "./axiosInstance";
export const uploadDocument = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/documents/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
};
export const listDocuments = async () => {
  const res = await api.get("/documents");
  return res.data;
};
export const deleteDocument = async (documentId) => {
  const res = await api.delete(`/documents/${documentId}`);
  return res.data;
};
export const getUserDocuments = async () => {
  const res = await api.get('/documents');
  return res.data.documents;
};
export const getDocumentChunks = async (documentId) => {
  const res = await api.get(`/documents/${documentId}/chunks`);
  return res.data.chunks;
};