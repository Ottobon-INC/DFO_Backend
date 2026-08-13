import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api';
import { 
  ArrowLeft, Users, UserPlus, CalendarCheck, Briefcase, 
  TrendingUp, Loader2, AlertCircle, MessageCircle
} from 'lucide-react';

const PERIOD_OPTIONS = [
  { label: 'Today', value: 'day' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'This Year', value: 'year' },
  { label: 'All Time', value: 'all' },
];

const SOURCE_COLORS: Record<string, string> = {
  'WhatsApp': '#25D366',
  'Walk-In': '#6366f1',
  'Referral': '#f59e0b',
  'Camp': '#ec4899',
  'Online': '#06b6d4',
  'Unknown': '#6b7280',
};

const PIPELINE_COLORS: Record<string, string> = {
  'New Inquiry': '#818cf8',
  'Contacted': '#38bdf8',
  'Follow Up': '#fbbf24',
  'Stalling - Sent to CRO': '#f97316',
  'Converted': '#34d399',
  'Not Interested': '#f87171',
  'Lost': '#ef4444',
};

function getColor(key: string, palette: Record<string, string>, index: number): string {
  if (palette[key]) return palette[key];
  const fallbacks = ['#8b5cf6','#14b8a6','#f43f5e','#84cc16','#e879f9','#fb923c'];
  return fallbacks[index % fallbacks.length];
}

interface ClinicAnalytics {
  clinic_id: string;
  clinic_name: string;
  period: string;
  overview: { total_leads: number; total_patients: number; total_appointments: number; total_staff: number };
  lead_pipeline: Record<string, number>;
  lead_sources: Record<string, number>;
  appointment_sources: Record<string, number>;
  conversion_rate: string;
  leads_in_period: number;
}

export default function ClinicDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ClinicAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('month');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    api.get(`/v1/superadmin/clinics/${id}/analytics?period=${period}`)
      .then(res => setData(res.data.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [id, period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <div className="flex items-center gap-3 p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400">
          <AlertCircle className="w-6 h-6" />
          <p>{error || 'Clinic not found'}</p>
        </div>
      </div>
    );
  }

  const sourceChartData = Object.entries(data.lead_sources).map(([name, value]) => ({ name, value })).filter(entry => !['Unknown', 'Practo', 'Camp', 'Online'].includes(entry.name));
  const pipelineChartData = Object.entries(data.lead_pipeline).map(([name, value]) => ({ name, value }));
  const apptSourceData = Object.entries(data.appointment_sources).map(([name, value]) => ({ name, value }));

  const statCards = [
    { label: 'Total Leads', value: data.overview.total_leads, icon: UserPlus, color: 'from-indigo-500/20 to-indigo-600/5', iconColor: 'text-indigo-400', borderColor: 'border-indigo-500/20' },
    { label: 'Total Patients', value: data.overview.total_patients, icon: Users, color: 'from-emerald-500/20 to-emerald-600/5', iconColor: 'text-emerald-400', borderColor: 'border-emerald-500/20' },
    { label: 'Appointments', value: data.overview.total_appointments, icon: CalendarCheck, color: 'from-sky-500/20 to-sky-600/5', iconColor: 'text-sky-400', borderColor: 'border-sky-500/20' },
    { label: 'Conversion Rate', value: data.conversion_rate, icon: TrendingUp, color: 'from-amber-500/20 to-amber-600/5', iconColor: 'text-amber-400', borderColor: 'border-amber-500/20' },
    { label: 'Staff Members', value: data.overview.total_staff, icon: Briefcase, color: 'from-purple-500/20 to-purple-600/5', iconColor: 'text-purple-400', borderColor: 'border-purple-500/20' },
  ];

  const whatsappLeads = data.lead_sources['WhatsApp'] || 0;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-all">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{data.clinic_name}</h1>
            <p className="text-sm text-zinc-500 mt-1">Clinic Analytics &middot; {data.leads_in_period} leads in selected period</p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                period === opt.value
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* WhatsApp Banner - ALWAYS VISIBLE */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl"
      >
        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-300">WhatsApp Channel Active</p>
          <p className="text-xs text-emerald-400/70">{whatsappLeads} lead{whatsappLeads !== 1 ? 's' : ''} received via WhatsApp in this period</p>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`bg-gradient-to-br ${card.color} backdrop-blur-md border ${card.borderColor} rounded-2xl p-5`}
          >
            <div className="flex items-center justify-between mb-3">
              <card.icon className={`w-5 h-5 ${card.iconColor}`} />
            </div>
            <p className="text-2xl font-bold text-white">{card.value}</p>
            <p className="text-xs text-zinc-400 mt-1">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6">
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800/50 rounded-3xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-1">Lead Sources</h2>
          <p className="text-xs text-zinc-500 mb-4">Where are your leads coming from?</p>
          {sourceChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={sourceChartData} cx="50%" cy="50%" innerRadius={65} outerRadius={110} paddingAngle={3} dataKey="value" stroke="none">
                  {sourceChartData.map((entry, index) => (
                    <Cell key={entry.name} fill={getColor(entry.name, SOURCE_COLORS, index)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#fff', fontSize: '13px' }} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#a1a1aa' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-zinc-600">No lead data for this period</div>
          )}
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800/50 rounded-3xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-1">Lead Pipeline</h2>
          <p className="text-xs text-zinc-500 mb-4">Funnel breakdown by status</p>
          {pipelineChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={pipelineChartData} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 12 }} />
                <YAxis dataKey="name" type="category" width={120} stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#fff', fontSize: '13px' }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
                  {pipelineChartData.map((entry, index) => (
                    <Cell key={entry.name} fill={getColor(entry.name, PIPELINE_COLORS, index)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-zinc-600">No pipeline data for this period</div>
          )}
        </motion.div>
      </div>

      {/* Appointment Sources */}
      {apptSourceData.length > 0 && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800/50 rounded-3xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-1">Appointment Sources</h2>
          <p className="text-xs text-zinc-500 mb-4">How patients are booking appointments</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {apptSourceData.map((item, i) => (
              <div key={item.name} className="bg-zinc-950/50 border border-zinc-800/50 rounded-2xl p-4 text-center">
                <p className="text-2xl font-bold text-white">{item.value}</p>
                <p className="text-xs text-zinc-500 mt-1">{item.name}</p>
                <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full" 
                    style={{ 
                      width: `${Math.min(100, (item.value / Math.max(...apptSourceData.map(d => d.value))) * 100)}%`,
                      backgroundColor: getColor(item.name, SOURCE_COLORS, i)
                    }} 
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
