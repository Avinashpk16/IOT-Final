import { initializeApp } from "firebase/app";
import { getDatabase }   from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAgpITmiBQY5ai8dXmMIarQs8kDmz1eiqI",
    authDomain: "vehicle-monitor-10591.firebaseapp.com",
    databaseURL: "https://vehicle-monitor-10591-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "vehicle-monitor-10591",
    storageBucket: "vehicle-monitor-10591.firebasestorage.app",
    messagingSenderId: "787508623117",
    appId: "1:787508623117:web:ac4fffa14b465d7e1be244"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);