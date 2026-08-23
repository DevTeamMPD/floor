import ShareQueuePage from "@/app/share/queue/page";
import ReturnedWorkOrders from "@/components/sales/returned-work-orders";

export const metadata = { title: "จองคิว — FloorNow" };

export default function SalesQueuePage() {
  return <div className="-m-4 md:-m-6"><div className="p-4 pb-0 md:p-6 md:pb-0"><ReturnedWorkOrders /></div><ShareQueuePage /></div>;
}
