import PageHeader from "../components/PageHeader";
import OffDaySchedulePanel from "../components/management/OffDaySchedulePanel";

export default function FleetSchedule() {
  return (
    <>
      <PageHeader title="Fleet Schedule" />
      <div className="p-3 md:p-6">
        <OffDaySchedulePanel />
      </div>
    </>
  );
}
