import PageHeader from "../components/PageHeader";
import OffDaySchedulePanel from "../components/management/OffDaySchedulePanel";

export default function FleetSchedule() {
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Fleet Schedule"
        subtitle="Review route truck run and off days across the week."
        centerMobile={false}
      />
      <div className="p-3 md:p-6">
        <OffDaySchedulePanel />
      </div>
    </>
  );
}
