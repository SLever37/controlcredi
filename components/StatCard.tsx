
import React from 'react';

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: string;
  trendColor?: string;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, trend, trendColor, onClick }) => {
  return (
    <div 
      className={`bg-slate-800/50 backdrop-blur-md border border-slate-700 p-6 rounded-2xl shadow-xl hover:border-blue-500/50 transition-all duration-300 ${onClick ? 'cursor-pointer hover:scale-[1.02] active:scale-95' : ''}`}
      onClick={onClick}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-slate-900 rounded-xl text-blue-400">
          {icon}
        </div>
        {trend && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${trendColor || 'bg-green-500/20 text-green-400'}`}>
            {trend}
          </span>
        )}
      </div>
      <div>
        <p className="text-slate-400 text-sm font-medium">{title}</p>
        <h3 className="text-2xl font-bold text-white mt-1">{value}</h3>
      </div>
    </div>
  );
};
