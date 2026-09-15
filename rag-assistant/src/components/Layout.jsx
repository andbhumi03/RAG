import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useState, useEffect } from "react";

export default function Layout({ children, chatSidebarProps, hideSidebar = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const shouldHideSidebar = hideSidebar || location.pathname === "/documents";

  // Swipe Back Gesture Handling (Left to Right from edge)
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    const handleTouchStart = (e) => {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    };

    const handleTouchEnd = (e) => {
      touchEndX = e.changedTouches[0].clientX;
      touchEndY = e.changedTouches[0].clientY;

      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);

      // Trigger back navigation if swiped from left edge (>120px right) and vertical movement is minimal (<70px)
      if (touchStartX < 70 && deltaX > 120 && deltaY < 70) {
        navigate(-1);
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [navigate]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = [
    {
      to: "/chat",
      label: "Chat Assistant",
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      )
    },
    {
      to: "/documents",
      label: "Documents Base",
      icon: (
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-white flex font-sans antialiased text-[#1f1f1f] overflow-hidden">
      {/* Sidebar container */}
      {!shouldHideSidebar && (
        <aside
          className={`bg-[#f0f4f9] border-r border-[#e3e8ef] flex flex-col shrink-0 h-screen overflow-hidden transition-all duration-300 ease-in-out ${isCollapsed ? "w-[68px]" : "w-64"
            }`}
        >
          {/* Branding & Hamburger */}
          <div className="p-4 border-b border-[#e3e8ef] flex items-center justify-between">
            <div className="flex items-center gap-3 overflow-hidden">
              {/* Gemini Multi-Pointed Colorful SVG Star */}
              <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-tr from-[#1a73e8] via-[#a142f4] to-[#ea4335] shadow-md animate-pulse">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" />
                </svg>
              </div>
              {!isCollapsed && (
                <div className="transition-opacity duration-300">
                  <h2 className="font-extrabold text-[#1f1f1f] text-sm tracking-tight">RAG</h2>
                  <p className="text-[9px] text-[#1a73e8] font-bold uppercase tracking-wider">Doc Assistant</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded-lg text-[#5f6368] hover:bg-[#e3e8ef] hover:text-[#1f1f1f] transition-colors cursor-pointer"
              aria-label="Toggle sidebar"
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

          {/* Primary Navigation */}
          <div className="py-4">
            {!isCollapsed && (
              <p className="px-5 mb-2 text-[9px] uppercase font-bold tracking-widest text-[#5f6368]">Menu</p>
            )}
            <nav className="space-y-1 px-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={isCollapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${isActive
                      ? "bg-[#c2e7ff] text-[#001d35] font-bold shadow-xs border-l-4 border-[#004a77]"
                      : "text-[#5f6368] hover:bg-[#e3e8ef] hover:text-[#1f1f1f]"
                    } ${isCollapsed ? "justify-center" : ""}`
                  }
                >
                  {item.icon}
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              ))}
            </nav>
          </div>
          {/* Chat History / Sessions list in Sidebar */}
          {chatSidebarProps && (
            <div className="flex-1 border-t border-[#e3e8ef] pt-4 flex flex-col min-h-0">
              <div className={`flex items-center justify-between px-5 mb-2 ${isCollapsed ? "justify-center" : ""}`}>
                {!isCollapsed ? (
                  <>
                    <span className="text-[9px] uppercase font-bold tracking-widest text-[#5f6368]">Recent Chats</span>
                    <button
                      onClick={chatSidebarProps.onNewChat}
                      className="text-[10px] font-bold text-[#1a73e8] hover:text-[#1557b0] transition-colors flex items-center gap-0.5 cursor-pointer"
                      aria-label="Start new chat"
                    >
                      <span>+ New</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={chatSidebarProps.onNewChat}
                    className="h-8 w-8 rounded-full bg-[#f0f4f9] hover:bg-[#e3e8ef] text-[#1a73e8] flex items-center justify-center border border-[#e3e8ef] transition-all cursor-pointer"
                    title="New chat"
                  >
                    <span>+</span>
                  </button>
                )}
              </div>
              {/* Scrollable list */}
              {!isCollapsed && (
                <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 pb-4 px-2 custom-scrollbar">
                  {chatSidebarProps.creatingChat && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#5f6368] bg-[#e3e8ef]/50 animate-pulse mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1a73e8] animate-ping" />
                      <span className="truncate font-medium text-[11px]">Starting...</span>
                    </div>
                  )}
                  {chatSidebarProps.sessions && chatSidebarProps.sessions.length > 0 ? (
                    chatSidebarProps.sessions.map((s) => (
                      <div
                        key={s._id}
                        onClick={() => chatSidebarProps.onSelectChat(s._id)}
                        className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all duration-150 ${chatSidebarProps.activeChatId === s._id
                            ? "bg-[#e3e8ef] text-[#1f1f1f] font-semibold"
                            : "text-[#5f6368] hover:bg-[#e3e8ef]/60 hover:text-[#1f1f1f]"
                          }`}
                      >
                        <span className="truncate flex-1 pr-2">{s.title || "New Chat"}</span>
                        <button
                          onClick={(e) => chatSidebarProps.onDeleteChat(e, s._id)}
                          aria-label={`Delete ${s.title || "chat"}`}
                          className="opacity-0 group-hover:opacity-100 text-[#5f6368] hover:text-red-600 transition-all duration-150 p-0.5 rounded cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-[#5f6368] text-xs py-4">No recent chats</div>
                  )}
                </div>
              )}
            </div>
          )}
          {!chatSidebarProps && <div className="flex-1" />}
          {/* Footer Area */}
          <div className="p-3 border-t border-[#e3e8ef] bg-[#f0f4f9] mt-auto">
            <div className={`flex items-center gap-2.5 px-1.5 py-1 ${isCollapsed ? "justify-center" : ""}`}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#1a73e8] to-[#a142f4] text-white font-bold text-xs flex items-center justify-center shadow-inner shrink-0">
                {user?.email ? user.email[0].toUpperCase() : "U"}
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#1f1f1f] truncate">{user?.email || "Workspace Member"}</p>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              title={isCollapsed ? "Sign Out" : undefined}
              className={`w-full mt-2 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 transition-colors border border-transparent hover:border-red-100 cursor-pointer ${isCollapsed ? "px-1.5" : ""
                }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {!isCollapsed && <span>Sign Out</span>}
            </button>
          </div>
        </aside>
      )}
      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-white">
        {children}
      </main>
    </div>
  );
}
