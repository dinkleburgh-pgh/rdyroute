import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
);

ChartJS.defaults.color = "#94a3b8";
ChartJS.defaults.borderColor = "rgba(148, 163, 184, 0.12)";
ChartJS.defaults.font.family = "inherit";
ChartJS.defaults.plugins.tooltip.backgroundColor = "#1e293b";
ChartJS.defaults.plugins.tooltip.titleColor = "#f1f5f9";
ChartJS.defaults.plugins.tooltip.bodyColor = "#cbd5e1";
ChartJS.defaults.plugins.tooltip.borderColor = "#334155";
ChartJS.defaults.plugins.tooltip.borderWidth = 1;
ChartJS.defaults.plugins.tooltip.padding = 10;
ChartJS.defaults.plugins.tooltip.cornerRadius = 6;
