import { useEffect, useState } from "react";
import { onSnapshot, orderBy, query } from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { emptyReadings, readingsCollection } from "../services/trackingService";

const empty = emptyReadings();

export default function useHealthReadings() {
  const [user, authLoading] = useAuthState(auth);
  const uid = user?.uid;
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(readingsCollection(uid), orderBy("date")),
      result => {
        const data = emptyReadings();
        for (const item of result.docs) {
          const reading = item.data();
          if (Object.hasOwn(data, reading.metric)) data[reading.metric].push({ ...reading, id: item.id });
        }
        setSnapshot({ uid, data, error: "" });
      },
      () => setSnapshot({ uid, data: empty, error: "Saved readings could not be loaded." }),
    );
  }, [uid]);

  const current = uid !== undefined && snapshot?.uid === uid ? snapshot : null;
  return {
    uid,
    healthData: current?.data ?? empty,
    readingsLoading: authLoading || (Boolean(uid) && !current),
    readingsError: current?.error ?? "",
  };
}
