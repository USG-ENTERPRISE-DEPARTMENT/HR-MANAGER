import React from 'react';
import { ShieldOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AccessDenied: React.FC = () => {
  const navigate = useNavigate();

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
        onClick={() => navigate('/dashboard')}
        className="px-6 py-2.5 bg-primary text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
      >
        Back to Dashboard
      </button>
    </div>
  );
};

export default AccessDenied;