import { createContext, useContext, useState, useEffect } from "react";
import API from "../api/axiosInstance";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Auto-restore session from stored JWT on page refresh
  useEffect(() => {
    const restoreSession = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        // Axios interceptor automatically passes the Authorization header
        const res = await API.get("/auth/me");
        if (res.data.user) {
          setUser(res.data.user);
        } else {
          localStorage.removeItem("token");
        }
      } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem("token");
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
  }, []);

  const login = async (email, password) => {
    try {
      const res = await API.post("/auth/login", { email, password });
      
      if (res.data.token) {
        localStorage.setItem("token", res.data.token);
      }
      setUser(res.data.user);
      return true;
    } catch (error) {
      throw new Error(error.response?.data?.error || "Login failed");
    }
  };

  const signup = async (name, email, password) => {
    try {
      const res = await API.post("/auth/signup", { name, email, password });

      if (res.data.token) {
        localStorage.setItem("token", res.data.token);
      }
      setUser(res.data.user);
      return true;
    } catch (error) {
      throw new Error(error.response?.data?.error || "Signup failed");
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, setLoading, login, signup, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);