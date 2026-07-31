import React from 'react';
import { ShieldOff } from 'lucide-react';

/**
 * Shown by ProtectedRoute when the user lacks the nav permission for a view.
 *
 * NOTE: this component must NOT use react-router hooks. The app has no Router mounted — navigation
 * is the `activeView` state switch in App.tsx — so calling useNavigate() here threw
 * "useNavigate() may be used only in the context of a <Router>", which unmounted the whole tree and
 * rendered a blank page instead of this message.
 *
 * `onBack` is supplied by callers that have App's navigate() to hand; without it we fall back to
 * setting activeView directly and reloading, which is how the rest of the app persists the view.
 */
const AccessDenied: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const goBack = () => {
    if (onBack) return onBack();
    // Fallback: mirror App.navigate() — persist the view, then reload so App picks it up.
    sessionStorage.setItem('activeView', 'Modules');
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-4">
      <div className="w-20 h-20 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-6">
        <ShieldOff size={40} className="text-red-500 dark:text-red-400" />
      </div>

      <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
        Access Denied
      </h1>

      <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-sm leading-relaxed">
        You don't have permission to view this page. Contact your administrator
        if you think this is a mistake.
      </p>

      <button
        onClick={goBack}
        className="primary-btn px-6 py-2.5"
      >
        Back to Modules
      </button>
    </div>
  );
};

export default AccessDenied;
