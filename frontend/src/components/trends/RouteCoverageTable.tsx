import { motion } from "framer-motion";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "../DataTable";
import type { RouteSwapLog } from "../../types";
import { format, parseISO } from "date-fns";

interface Props {
  data: RouteSwapLog[];
  isLoading: boolean;
}

export default function RouteCoverageTable({ data, isLoading }: Props) {
  const columns: ColumnDef<RouteSwapLog>[] = [
    {
      header: "Date",
      accessorKey: "run_date",
      cell: ({ getValue }) => {
        const v = getValue<string>();
        try {
          return <span className="tabular-nums text-slate-400">{format(parseISO(v), "MMM d, yyyy")}</span>;
        } catch {
          return <span className="tabular-nums text-slate-400">{v}</span>;
        }
      },
    },
    {
      header: "Route truck",
      accessorKey: "route_truck",
      cell: ({ getValue }) => (
        <span className="font-semibold">#{getValue<number>()}</span>
      ),
    },
    {
      header: "Loaded by",
      accessorKey: "load_on_truck",
      cell: ({ row }) => {
        const isSelf = row.original.load_on_truck === row.original.route_truck;
        return isSelf ? (
          <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
            Self
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-violet-900/40 px-2 py-0.5 text-xs font-medium text-violet-300">
            #{row.original.load_on_truck}
          </span>
        );
      },
    },
  ];

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Route Coverage / Swap History</h3>
        <p className="text-xs text-slate-500">Route swaps and coverage assignments</p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <span className="flex items-center gap-2 text-sm text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Loading...
          </span>
        </div>
      )}

      {!isLoading && (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Search trucks or dates..."
          pageSize={20}
        />
      )}
    </motion.div>
  );
}
