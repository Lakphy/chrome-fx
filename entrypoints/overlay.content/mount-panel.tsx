import { createRoot, type Root } from 'react-dom/client';
import App from '../panel/App.tsx';

export function mountPanel(container: HTMLElement): Root {
  const root = createRoot(container);
  root.render(<App />);
  return root;
}
