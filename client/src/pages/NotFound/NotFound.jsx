import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../../components/common/ui.jsx';
import { useSeo } from '../../hooks/index.js';

export default function NotFound() {
  useSeo({ title: 'Page not found | Nutex Wholesale', noindex: true });
  return (
    <div className="container page">
      <EmptyState icon={Compass} title="Page not found" action={<Link to="/shop" className="btn btn-primary">Browse products</Link>}>
        The page you are looking for does not exist or has moved.
      </EmptyState>
    </div>
  );
}
