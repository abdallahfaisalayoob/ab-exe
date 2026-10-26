import { lazy, Suspense, useEffect } from 'react';
import { useApp } from './state/store';
import { setShield } from './state/actions';
import { SetupScreen } from './ui/lock/SetupScreen';
import { LockScreen } from './ui/lock/LockScreen';
import { ConfirmDialog, PrivacyShield, Toasts } from './ui/Overlays';
import { HomeScreen } from './ui/screens/HomeScreen';
import { Spinner } from './ui/kit';

// Heavier screens load on demand to keep the first paint fast.
const CameraScreen = lazy(() => import('./ui/screens/CameraScreen'));
const ReviewScreen = lazy(() => import('./ui/screens/ReviewScreen'));
const EditorScreen = lazy(() => import('./ui/screens/EditorScreen'));
const LibraryScreen = lazy(() => import('./ui/screens/LibraryScreen'));
const SettingsScreen = lazy(() => import('./ui/screens/SettingsScreen'));

function Unlocked() {
  const route = useApp((s) => s.route);
  let screen;
  switch (route.name) {
    case 'home':
      screen = <HomeScreen />;
      break;
    case 'library':
      screen = <LibraryScreen collectionId={route.collectionId ?? null} focusSearch={route.focusSearch} />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'camera':
      screen = <CameraScreen key={`${route.docId}:${route.retakePageId ?? ''}`} docId={route.docId} retakePageId={route.retakePageId} />;
      break;
    case 'review':
      screen = <ReviewScreen key={route.docId} docId={route.docId} />;
      break;
    case 'editor':
      screen = <EditorScreen key={route.pageId} docId={route.docId} pageId={route.pageId} />;
      break;
  }
  return (
    <Suspense
      fallback={
        <div className="center-fill">
          <Spinner large />
        </div>
      }
    >
      {screen}
    </Suspense>
  );
}

export default function App() {
  const phase = useApp((s) => s.phase);
  const fatal = useApp((s) => s.fatal);

  useEffect(() => {
    document.getElementById('boot')?.remove();
  }, []);

  useEffect(() => {
    const onVis = () => setShield(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', () => setShield(true));
    window.addEventListener('pageshow', () => setShield(false));
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return (
    <>
      {phase === 'boot' && (
        <div className="center-fill">
          <Spinner large />
        </div>
      )}
      {phase === 'fatal' && (
        <main className="lock">
          <div className="lock__inner">
            <h1 className="lock__title">Storage unavailable</h1>
            <p className="lock__lead">{fatal}</p>
            <p className="faint">Private Browsing and some content blockers prevent on-device storage. Open the app in a normal Safari tab or from the Home Screen.</p>
          </div>
        </main>
      )}
      {phase === 'setup' && <SetupScreen />}
      {phase === 'locked' && <LockScreen />}
      {/* Document UI exists only while unlocked: there is no route to it otherwise. */}
      {phase === 'unlocked' && <Unlocked />}
      <Toasts />
      <ConfirmDialog />
      {phase === 'unlocked' && <PrivacyShield />}
    </>
  );
}
