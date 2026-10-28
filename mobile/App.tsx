import NetInfo from "@react-native-community/netinfo";
import React, { useEffect, useState } from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  StyleSheet,
} from "react-native";
import {
  client,
  configured,
  getBox,
  run,
  stop,
  isRunning,
  flush,
  recover,
  bleConnected,
} from "./src/runtime";
import type { Drive } from "./src/outbox";
export default function App() {
  const [internet, setInternet] = useState("unknown");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [owner, setOwner] = useState<string>();
  const [mode, setMode] = useState(false);
  const [device, setDevice] = useState("");
  const [service, setService] = useState("");
  const [characteristic, setCharacteristic] = useState("");
  const [background, setBackground] = useState(false);
  const [drive, setDrive] = useState<Drive | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [ble, setBle] = useState(false);
  async function refresh() {
    const box = await getBox();
    setDrive(await box.drive());
    setPending(await box.count());
    setRunning(isRunning());
    setBle(bleConnected());
    setError(await box.lastError());
  }
  useEffect(() => {
    void client.auth
      .getSession()
      .then(({ data }) => setOwner(data.session?.user.id));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) =>
      setOwner(session?.user.id),
    );
    const unwatchNetwork = NetInfo.addEventListener((s) =>
      setInternet(
        s.isConnected && s.isInternetReachable !== false
          ? "available"
          : "offline",
      ),
    );
    void getBox()
      .then((box) => box.drive())
      .then((d) => {
        if (d && !d.stopped) {
          setMode(d.source === "device");
          setDevice(d.device);
          setService(d.service);
          setCharacteristic(d.characteristic);
          setBackground(d.background ?? false);
        }
      });
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      subscription.unsubscribe();
      unwatchNetwork();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (owner)
      void recover()
        .then(refresh)
        .catch((e) => setError(String(e)));
  }, [owner]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!owner) throw new Error("Sign in first");
    if (
      mode &&
      (!device.trim() ||
        !/^[0-9a-f-]{36}$/i.test(service) ||
        !/^[0-9a-f-]{36}$/i.test(characteristic))
    )
      throw new Error(
        "Provide device identifier and GATT UUIDs from the bench peripheral",
      );
    const { data, error } = await client.rpc("create_driving_session", {
      p_label: mode ? "Phone gateway" : "Phone gateway — SIMULATED BLE",
      p_data_source: mode ? "device" : "simulated",
    });
    if (error) throw error;
    const d: Drive = {
      id: data,
      owner,
      source: mode ? "device" : "simulated",
      startedAt: new Date().toISOString(),
      stopped: false,
      device: device.trim(),
      service,
      characteristic,
    };
    const { data: created, error: loadError } = await client
      .from("driving_sessions")
      .select("started_at")
      .eq("id", data)
      .single();
    if (loadError || !created)
      throw loadError ?? new Error("Session creation not confirmed");
    d.startedAt = created.started_at;
    // Persist before permission dialogs. Recovery never silently creates a replacement session.
    await (await getBox()).saveDrive(d);
    setDrive(d);
    await run(d, background);
  }
  const input = (
    label: string,
    value: string,
    set: (s: string) => void,
    secret = false,
  ) => (
    <View>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={set}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>MSD Phone Gateway</Text>
        <Text>
          Configure while parked. Background behavior has not been validated on
          physical phones.
        </Text>
        {!configured && (
          <Text>Set public Supabase configuration in .env, then rebuild.</Text>
        )}
        {!owner ? (
          <View>
            {input("Email", email, setEmail)}
            {input("Password", password, setPassword, true)}
            <Button
              title="Sign in"
              disabled={busy || !configured}
              onPress={() =>
                void action(async () => {
                  const { error } = await client.auth.signInWithPassword({
                    email,
                    password,
                  });
                  if (error) throw error;
                  setPassword("");
                })
              }
            />
          </View>
        ) : (
          <>
            <Text>Authenticated as session owner · Internet: {internet}</Text>
            <Text>Hardware BLE (off = explicitly simulated events)</Text>
            <Switch disabled={running} value={mode} onValueChange={setMode} />
            {mode && (
              <View>
                {input(
                  "Peripheral ID (Android MAC / iOS UUID)",
                  device,
                  setDevice,
                )}
                {input("GATT service UUID", service, setService)}
                {input(
                  "Event characteristic UUID",
                  characteristic,
                  setCharacteristic,
                )}
              </View>
            )}
            <Text>Request background location (experimental)</Text>
            <Switch
              disabled={running}
              value={background}
              onValueChange={setBackground}
            />
            <Text>Session: {drive?.id ?? "none"}</Text>
            <Text>
              Source: {drive?.source ?? (mode ? "device" : "simulated")}
            </Text>
            <Text>
              Collection: {running ? "running" : "stopped"} · BLE:{" "}
              {ble ? "connected" : "disconnected"} · Pending uploads: {pending}
            </Text>
            <Text>
              IMU current state: unavailable / gray. Sparse events never
              establish green.
            </Text>
            <Button
              title="Start new session"
              disabled={
                busy || running || (!!drive && !drive.stopped) || pending > 0
              }
              onPress={() => void action(start)}
            />
            {drive && !drive.stopped && (
              <Button
                title="Resume saved session"
                disabled={busy || running}
                onPress={() => void action(() => run(drive, background))}
              />
            )}
            <Button
              title="End session"
              disabled={busy || !drive || drive.stopped}
              onPress={() => void action(stop)}
            />
            <Button
              title="Retry uploads"
              disabled={busy}
              onPress={() => void action(flush)}
            />
            <Button
              title="Sign out"
              disabled={
                busy || running || (!!drive && !drive.stopped) || pending > 0
              }
              onPress={() =>
                void action(async () => {
                  await client.auth.signOut();
                })
              }
            />
          </>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text>
          Raw IMU recordings stay on the ESP32-S3. No phone accelerometer is
          used. No monitoring dashboard is provided here.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f5f7fa" },
  content: { padding: 24, gap: 18 },
  title: { fontSize: 26, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#718096",
    borderRadius: 6,
    padding: 12,
    marginVertical: 8,
  },
  error: { color: "#a50000" },
});
