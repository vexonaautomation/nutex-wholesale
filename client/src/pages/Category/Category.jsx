import { useParams, Link } from 'react-router-dom';
import { FolderX } from 'lucide-react';
import { useStore } from '../../context/StoreContext.jsx';
import Shop from '../Shop/Shop.jsx';
import { EmptyState, PageLoader } from '../../components/common/ui.jsx';

export default function Category() {
  const { slug } = useParams();
  const { categories, loading } = useStore();
  const category = categories.find((c) => c.slug === slug);
  if (loading && !categories.length) return <PageLoader />;
  if (!category) {
    return (
      <div className="container page">
        <EmptyState icon={FolderX} title="Category not available" action={<Link to="/shop" className="btn btn-primary">Browse all products</Link>}>
          This category may have been renamed or is currently unavailable.
        </EmptyState>
      </div>
    );
  }
  return <Shop key={category.slug} category={category} />;
}
