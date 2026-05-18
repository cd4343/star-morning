import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  fullWidth = false,
  loading = false,
  className = '', 
  disabled,
  ...props 
}) => {
  const base = "rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-gray-900 text-white shadow-lg hover:bg-gray-800",
    secondary: "bg-white text-gray-900 border-2 border-gray-200 hover:border-gray-300",
    accent: "bg-yellow-400 text-yellow-900 hover:bg-yellow-300",
    danger: "bg-red-100 text-red-600 hover:bg-red-200",
    ghost: "bg-transparent text-gray-500 hover:bg-gray-100"
  };

  const sizes = {
    sm: "px-3 py-1 text-xs",
    md: "px-4 py-3 text-sm",
    lg: "px-6 py-4 text-lg"
  };

  return (
    <button 
      className={`${base} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {children}
    </button>
  );
};

