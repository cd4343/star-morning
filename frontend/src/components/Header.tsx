import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  title: string;
  onBack?: () => void;
  showBack?: boolean;
  rightElem?: React.ReactNode;
  className?: string;
}

export const Header: React.FC<HeaderProps> = ({ title, onBack, showBack = false, rightElem, className = '' }) => {
  const navigate = useNavigate();
  
  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  return (
    <div className={`flex items-center justify-between p-4 bg-white border-b z-10 sticky top-0 ${className}`}>
      <div className="flex items-center">
        {showBack && (
          <button onClick={handleBack} className="mr-2 p-1 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700" />
          </button>
        )}
        <h1 className="text-lg font-bold text-gray-800">{title}</h1>
      </div>
      {rightElem}
    </div>
  );
};

