const SUPABASE_URL = "https://xxwlrshgdupnpejurhqi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4d2xyc2hnZHVwbnBlanVyaHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMTU1NDAsImV4cCI6MjA5NTc5MTU0MH0.MrIpDTGc9H-YbhVXdrHAA50UbWqMI2SULb_3XjeKTJU";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);


function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const borderColors = {
        success: 'border-emerald-500 bg-white text-slate-800 shadow-md',
        error: 'border-red-500 bg-white text-slate-800 shadow-md',
        info: 'border-cyan-500 bg-white text-slate-800 shadow-md'
    };

    toast.className = `p-4 border-l-4 rounded-r-lg shadow-lg flex flex-col transition duration-300 transform translate-y-2 ${borderColors[type] || borderColors.info}`;
    toast.innerHTML = `
        <strong class="font-bold text-sm text-slate-900">${title}</strong>
        <span class="text-xs text-slate-600 mt-0.5">${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}