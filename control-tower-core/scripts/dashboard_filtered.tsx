import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api';
import { 
  Building2, Users, Plus, Trash2, UserPlus, TrendingUp,
  X, Loader2, Search, CheckCircle2, AlertCircle, FileText, ChevronRight, MessageCircle, CalendarCheck
} from 'lucide-react';

const PERIOD_OPTIONS = [
  { label: 'Today', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
  { label: 'All', value: 'all' },
];

const SOURCE_COLORS: Record<string, string> = {
  'WhatsApp': '#25D366',
  'Walk-In': '#6366f1',
  'Referral': '#f59e0b',
  'Camp': '#ec4899',
  'Online': '#06b6d4',
  'Social Media': '#ec4899',
  'Phone Call': '#14b8a6',
  'Website': '#06b6d4',
};

function getColor(key: string, index: number): string {
  if (SOURCE_COLORS[key]) return SOURCE_COLORS[key];
  const fallbacks = ['#8b5cf6','#14b8a6','#f43f5e','#84cc16','#e879f9','#fb923c'];
  return fallbacks[index % fallbacks.length];
}

interface Clinic {
  id: string;
  name: string;
  created_at: string;
  users_count: number;
}

interface OverviewData {
  period: string;
  total_clinics: number;
  total_patients: number;
  total_leads: number;
  total_appointments: number;
  global_lead_sources: Record<string, number>;
  global_conversion_rate: string;
  leads_in_period: number;
  clinics_summary: Array<{ id: string; name: string; leads: number; appointments: number; conversion_rate: string }>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('month');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const [analytics, setAnalytics] = useState<{ total_clinics: number, total_patients: number, total_files: number } | null>(null);

  const [formData, setFormData] = useState({ clinic_name: '', owner_name: '', owner_email: '', owner_role: 'Doctor' });
  const [formStatus, setFormStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [formMsg, setFormMsg] = useState('');

  const fetchClinics = async () => {
    try {
      const res = await api.get('/v1/superadmin/clinics');
      setClinics(res.data.data);
    } catch (error) {
      console.error('Failed to fetch clinics', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOverview = async (p: string) => {
    setOverviewLoading(true);
    try {
      const res = await api.get(`/v1/superadmin/analytics/overview?period=${p}`);
      setOverview(res.data.data);
    } catch (error) {
      console.error('Failed to fetch overview', error);
      try {
        const res = await api.get('/v1/superadmin/analytics');
        setAnalytics(res.data.data);
      } catch (e) { /* ignore */ }
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => { fetchClinics(); }, []);
  useEffect(() => { fetchOverview(period); }, [period]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you absolutely sure? This is a HARD DELETE and will wipe the clinic and all its users permanently.')) return;
    try {
      await api.delete(`/v1/superadmin/clinics/${id}`);
      setClinics(clinics.filter(c => c.id !== id));
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to delete clinic');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormStatus('loading');
    try {
      await api.post('/v1/superadmin/clinics', formData);
      setFormStatus('success');
      setFormMsg('Provisioned successfully! The Owner Password is: Temporary123!');
      setFormData({ clinic_name: '', owner_name: '', owner_email: '', owner_role: 'Doctor' });
      fetchClinics();
      setTimeout(() => { setIsModalOpen(false); setFormStatus('idle'); }, 5000);
    } catch (err: any) {
      setFormStatus('error');
      setFormMsg(err.response?.data?.error || 'Error creating clinic');
    }
  };

  const filteredClinics = clinics.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const clinicSummaryMap: Record<string, { leads: number; appointments: number; conversion_rate: string }> = {};
  if (overview?.clinics_summary) {
    overview.clinics_summary.forEach(cs => {
      clinicSummaryMap[cs.id] = { leads: cs.leads, appointments: cs.appointments, conversion_rate: cs.conversion_rate };
    });
  }

  // Filter out any garbage sources that shouldn't appear on the chart
  const sourceChartData = overview?.global_lead_sources 
    ? Object.entries(overview.global_lead_sources)
        .map(([name, value]) => ({ name, value }))
        .filter(entry => !['Unknown', 'Practo', 'Camp', 'Online'].includes(entry.name))
    : [];

  if (loading) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-zinc-500" /></div>;
  }

  return (
    <div className="p-8 pb-24">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Analytics Overview</h1>
          <p className="text-zinc-400">Monitor and manage all tenant clinics.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  period === opt.value
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-white text-black hover:bg-zinc-200 font-semibold py-2.5 px-5 rounded-xl transition-all"
          >
            <Plus className="w-4 h-4" /> Provision Clinic
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-gradient-to-br from-indigo-500/20 to-indigo-600/5 backdrop-blur-md border border-indigo-500/20 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><Building2 className="w-5 h-5 text-indigo-400" /></div>
          <p className="text-2xl font-bold text-white">{overview?.total_clinics ?? analytics?.total_clinics ?? 0}</p>
          <p className="text-xs text-zinc-400 mt-1">Total Clinics</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><Users className="w-5 h-5 text-emerald-400" /></div>
          <p className="text-2xl font-bold text-white">{overview?.total_patients ?? analytics?.total_patients ?? 0}</p>
          <p className="text-xs text-zinc-400 mt-1">Total Patients</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-gradient-to-br from-sky-500/20 to-sky-600/5 backdrop-blur-md border border-sky-500/20 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><UserPlus className="w-5 h-5 text-sky-400" /></div>
          <p className="text-2xl font-bold text-white">{overview?.total_leads ?? 0}</p>
          <p className="text-xs text-zinc-400 mt-1">Total Leads</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gradient-to-br from-amber-500/20 to-amber-600/5 backdrop-blur-md border border-amber-500/20 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><CalendarCheck className="w-5 h-5 text-amber-400" /></div>
          <p className="text-2xl font-bold text-white">{overview?.total_appointments ?? 0}</p>
          <p className="text-xs text-zinc-400 mt-1">Appointments</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-gradient-to-br from-purple-500/20 to-purple-600/5 backdrop-blur-md border border-purple-500/20 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><TrendingUp className="w-5 h-5 text-purple-400" /></div>
          <p className="text-2xl font-bold text-white">{overview?.global_conversion_rate ?? '0%'}</p>
          <p className="text-xs text-zinc-400 mt-1">Conversion Rate</p>
        </motion.div>
      </div>

      {sourceChartData.length > 0 && (
        <div className="grid grid-cols-3 gap-6 mb-8">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="col-span-2 bg-zinc-900/50 backdrop-blur-md border border-zinc-800/50 rounded-3xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1">Lead Sources</h2>
            <p className="text-xs text-zinc-500 mb-4">Global distribution across all clinics</p>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={sourceChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={105} paddingAngle={3} dataKey="value" stroke="none">
                  {sourceChartData.map((entry, index) => (
                    <Cell key={entry.name} fill={getColor(entry.name, index)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '12px', color: '#fff', fontSize: '13px' }} />
                <Legend wrapperStyle={{ fontSize: '12px', color: '#a1a1aa' }} />
              </PieChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex flex-col gap-4">
            <div className="flex-1 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-3xl p-5 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="text-sm font-semibold text-emerald-300">WhatsApp Leads</span>
              </div>
              <p className="text-3xl font-bold text-white">{overview?.global_lead_sources?.['WhatsApp'] ?? 0}</p>
              <p className="text-xs text-zinc-500 mt-1">via WhatsApp channel</p>
            </div>

            <div className="flex-1 bg-zinc-900/50 border border-zinc-800/50 rounded-3xl p-5 flex flex-col justify-center">
              <p className="text-xs text-zinc-500 mb-2">Leads in selected period</p>
              <p className="text-3xl font-bold text-white">{overview?.leads_in_period ?? 0}</p>
              <p className="text-xs text-zinc-500 mt-1">{period === 'all' ? 'all time' : `last ${period}`}</p>
            </div>
          </motion.div>
        </div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800/50 rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800/50 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Active Deployments</h2>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-zinc-500" />
            </div>
            <input 
              type="text" 
              placeholder="Search clinics..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg py-2 pl-10 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-950/50 border-b border-zinc-800/50 text-sm font-medium text-zinc-400 uppercase tracking-wider">
                <th className="px-6 py-4">Clinic Name</th>
                <th className="px-6 py-4">Users</th>
                <th className="px-6 py-4">Leads</th>
                <th className="px-6 py-4">Appointments</th>
                <th className="px-6 py-4">Conversion</th>
                <th className="px-6 py-4">Created On</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredClinics.map((clinic) => {
                const summary = clinicSummaryMap[clinic.id];
                return (
                  <tr 
                    key={clinic.id} 
                    className="hover:bg-zinc-800/20 transition-colors cursor-pointer group"
                    onClick={() => navigate(`/clinic/${clinic.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                          <Building2 className="w-4 h-4 text-indigo-400" />
                        </div>
                        <span className="text-sm font-medium text-zinc-200">{clinic.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-300">
                        {clinic.users_count} accounts
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300 font-medium">{summary?.leads ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-zinc-300 font-medium">{summary?.appointments ?? '—'}</td>
                    <td className="px-6 py-4">
                      {summary?.conversion_rate ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          parseFloat(summary.conversion_rate) >= 50 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : parseFloat(summary.conversion_rate) >= 20 
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          {summary.conversion_rate}
                        </span>
                      ) : (
                        <span className="text-sm text-zinc-600">&mdash;</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-500">
                      {new Date(clinic.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDelete(clinic.id); }}
                          className="text-zinc-500 hover:text-red-400 transition-colors p-2 hover:bg-red-500/10 rounded-lg"
                          title="Hard Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredClinics.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                    No clinics found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      <AnimatePresence>
        {isModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" 
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 w-full max-w-md bg-zinc-950 border-l border-zinc-800 z-[101] shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between p-6 border-b border-zinc-800">
                <h2 className="text-xl font-semibold text-white">Provision New Clinic</h2>
                <button onClick={() => setIsModalOpen(false)} className="text-zinc-500 hover:text-white p-2 hover:bg-zinc-900 rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                <form onSubmit={handleCreate} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Clinic Name</label>
                    <input required type="text" value={formData.clinic_name} onChange={e => setFormData({...formData, clinic_name: e.target.value})} placeholder="Apollo Hospitals" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Owner Name</label>
                    <input required type="text" value={formData.owner_name} onChange={e => setFormData({...formData, owner_name: e.target.value})} placeholder="Dr. Sarah Jenkins" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Owner Email</label>
                    <input required type="email" value={formData.owner_email} onChange={e => setFormData({...formData, owner_email: e.target.value})} placeholder="sarah@apollo.com" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Owner Role</label>
                    <select value={formData.owner_role} onChange={e => setFormData({...formData, owner_role: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="Doctor">Doctor</option>
                      <option value="CRO">CRO</option>
                      <option value="Receptionist">Receptionist</option>
                      <option value="Nurse">Nurse</option>
                    </select>
                  </div>

                  {formStatus === 'error' && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                      <AlertCircle className="w-5 h-5" /><p className="text-sm">{formMsg}</p>
                    </div>
                  )}
                  {formStatus === 'success' && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                      <CheckCircle2 className="w-5 h-5" /><p className="text-sm">{formMsg}</p>
                    </div>
                  )}

                  <button type="submit" disabled={formStatus === 'loading'} className="w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-zinc-200 font-semibold py-3.5 px-6 rounded-xl transition-all disabled:opacity-50 mt-8">
                    {formStatus === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create & Provision Admin'}
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
