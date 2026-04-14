import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useCustomizer } from "@/hooks/use-customizer";
import {
  useGetAdminMe,
  useGetProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getGetProductsQueryKey,
  useGetFits, useCreateFit, useUpdateFit, useDeleteFit, getGetFitsQueryKey,
  useGetColors, useAddColor, useDeleteColor, getGetColorsQueryKey,
  useGetSizes, useAddSize, useUpdateSize, useDeleteSize, getGetSizesQueryKey,
  useGetMockup, useSaveMockup, getGetMockupQueryKey,
  useGetAdminOrderSettings, useUpdateAdminOrderSettings, getGetAdminOrderSettingsQueryKey,
  useAdminLogout,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Edit, LogOut, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { motion } from "framer-motion";
import { CUSTOM_FONTS } from "@/config/fonts";

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Immediately block if no token is stored — no API call needed
  const [hasToken] = useState(() => !!localStorage.getItem("wearurway_admin_token"));

  // Force a fresh auth check every time this page is visited (ignore cache)
  useEffect(() => {
    if (hasToken) {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
    }
  }, [hasToken, queryClient]);

  const { data: adminMe, isFetching: isAuthLoading, isError: isAuthError } = useGetAdminMe({
    query: { enabled: hasToken },
  });
  const logoutMutation = useAdminLogout();

  useEffect(() => {
    if (!hasToken) {
      setLocation("/admin");
      return;
    }
    if (!isAuthLoading && (isAuthError || (adminMe && !adminMe.authenticated))) {
      setLocation("/admin");
    }
  }, [hasToken, adminMe, isAuthLoading, isAuthError, setLocation]);

  const handleLogout = () => {
    logoutMutation.mutate({}, {
      onSuccess: () => {
        localStorage.removeItem("wearurway_admin_token");
        queryClient.clear();
        setLocation("/admin");
      }
    });
  };

  // Show verifying until we have a confirmed fresh response
  if (!hasToken || isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground animate-pulse">Verifying...</p>
      </div>
    );
  }

  if (!adminMe?.authenticated) return null;

  return (
    <div className="min-h-screen pt-24 px-6 md:px-12 lg:px-24 max-w-7xl mx-auto pb-24">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="flex items-end justify-between mb-2">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tighter uppercase">Admin Panel</h1>
          <Button variant="ghost" onClick={handleLogout} className="uppercase tracking-widest text-xs mb-2 rounded-none">
            <LogOut className="w-4 h-4 mr-2" /> Logout
          </Button>
        </div>
        <p className="text-muted-foreground text-lg mb-12">Manage everything without touching code.</p>

        <Tabs defaultValue="products" className="w-full">
          <TabsList className="mb-12 rounded-none border-b border-border bg-transparent h-auto p-0 flex space-x-8 overflow-x-auto justify-start w-full">
            {["products", "fits", "colors", "sizes", "mockups", "settings", "fonts"].map(tab => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent pb-3 uppercase tracking-widest text-xs px-0 font-medium"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="products"><ProductsManager /></TabsContent>
          <TabsContent value="fits"><FitsManager /></TabsContent>
          <TabsContent value="colors"><ColorsManager /></TabsContent>
          <TabsContent value="sizes"><SizesManager /></TabsContent>
          <TabsContent value="mockups"><MockupsManager /></TabsContent>
          <TabsContent value="settings"><OrderSettingsManager /></TabsContent>
          <TabsContent value="fonts"><FontsManager /></TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}

// ─── Image Upload Helper ────────────────────────────────────────────────────

function toSafeFilename(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toMockupFilenamePart(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildMockupFilename(productName: string, fitName: string, colorName: string, side: "front" | "back"): string {
  const parts = [productName, fitName, colorName].map(toMockupFilenamePart);
  if (parts.some(part => !part)) return "";
  return `${parts.join("_")}_${side}.png`;
}

function ImageUploader({ value, onChange, label = "Image", uploadPath = "/api/uploads" }: {
  value: string; onChange: (url: string) => void; label?: string; uploadPath?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingName, setPendingName] = useState("");

  const safeName = toSafeFilename(pendingName);
  const previewFilename = safeName ? `${safeName}.png` : "";

  const handleFile = async (file: File) => {
    if (!safeName) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", safeName);
      const token = localStorage.getItem("wearurway_admin_token");
      const res = await fetch(uploadPath, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as { url: string };
      onChange(data.url);
      setPendingName("");
    } catch { /* silent */ }
    finally { setUploading(false); }
  };

  const handleRemove = async () => {
    if (value) {
      const token = localStorage.getItem("wearurway_admin_token");
      const match = value.match(/^(\/api(?:\/[^/]+)+)\/([^/]+)$/);
      if (match) {
        await fetch(`${match[1]}/${match[2]}`, {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).catch(() => {});
      }
    }
    onChange("");
  };

  return (
    <div className="space-y-2">
      <Label className="uppercase tracking-widest text-xs">{label}</Label>
      {value ? (
        <div className="relative w-fit">
          <div className="w-32 h-32 border border-border overflow-hidden bg-muted/10">
            <img src={value} alt="preview" className="w-full h-full object-contain" />
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs leading-none hover:opacity-80 transition-opacity"
            title="Remove image"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <Input
              value={pendingName}
              onChange={e => setPendingName(e.target.value)}
              placeholder="File name (e.g. black_front)"
              className="rounded-none h-10 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              className="rounded-none h-10 whitespace-nowrap"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || !safeName}
            >
              <Upload className="w-4 h-4 mr-2" />{uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
          {previewFilename && (
            <p className="text-xs font-mono text-muted-foreground">
              Will be saved as: <span className="text-foreground">{previewFilename}</span>
            </p>
          )}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

// ─── Shared admin card action sidebar ──────────────────────────────────────

function AdminActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 justify-start pt-1 min-w-[120px]">
      {children}
    </div>
  );
}

// ─── Products Manager ───────────────────────────────────────────────────────

function ProductsManager() {
  const { data: products } = useGetProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", available: true, comingSoon: false, image: "" });

  const openAdd = () => {
    setEditId(null);
    setForm({ name: "", available: true, comingSoon: false, image: "" });
    setIsOpen(true);
  };

  const openEdit = (p: NonNullable<typeof products>[0]) => {
    setEditId(p.id);
    setForm({ name: p.name, available: p.available, comingSoon: p.comingSoon, image: p.image ?? "" });
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editId) {
      updateProduct.mutate({ id: editId, data: form }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() }); toast({ title: "Product updated" }); setIsOpen(false); }
      });
    } else {
      createProduct.mutate({ data: form }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() }); toast({ title: "Product created" }); setIsOpen(false); }
      });
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This removes all its fits, colors, and sizes.`)) return;
    deleteProduct.mutate({ id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() }); toast({ title: "Deleted" }); }
    });
  };

  const handleToggle = (id: string, field: "available" | "comingSoon", value: boolean) => {
    const other = field === "available" ? "comingSoon" : "available";
    updateProduct.mutate({ id, data: { [field]: value, ...(value ? { [other]: false } : {}) } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() })
    });
  };

  return (
    <div className="space-y-6">
      {/* Add card */}
      <motion.div
        onClick={openAdd}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="group relative h-[180px] border border-dashed border-border flex flex-col justify-center items-center cursor-pointer hover:border-foreground transition-colors bg-transparent"
      >
        <Plus className="w-8 h-8 text-muted-foreground group-hover:text-foreground transition-colors mb-2" />
        <span className="text-xs uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">Add Product</span>
      </motion.div>

      {/* Product cards */}
      {products?.map((product, i) => (
        <motion.div
          key={product.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex gap-4 items-start"
        >
          {/* Card matching the products page style */}
          <div className={`relative flex-1 h-[240px] border border-border p-6 flex flex-col justify-end overflow-hidden ${product.available ? "bg-card" : "opacity-60 bg-muted/20"}`}>
            {product.image && <img src={product.image} alt={product.name} className="absolute inset-0 w-full h-full object-cover opacity-30" />}
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent z-10" />
            <div className="relative z-20">
              <h3 className="text-2xl font-bold uppercase tracking-tight mb-1">{product.name}</h3>
              <div className="flex gap-2 flex-wrap">
                {!product.available && (
                  <span className="inline-block px-3 py-1 bg-muted text-muted-foreground text-xs font-medium tracking-widest uppercase">
                    Coming Soon
                  </span>
                )}
                {product.available && (
                  <span className="inline-block px-3 py-1 bg-foreground text-background text-xs font-medium tracking-widest uppercase">
                    Available
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons beside the card */}
          <AdminActions>
            <Button variant="outline" className="rounded-none uppercase tracking-widest text-xs w-full justify-start" onClick={() => openEdit(product)}>
              <Edit className="w-3.5 h-3.5 mr-2" /> Edit
            </Button>
            <Button variant="outline" className="rounded-none uppercase tracking-widest text-xs w-full justify-start text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => handleDelete(product.id, product.name)}>
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
            </Button>
            <div className="border border-border p-2 space-y-2 mt-1">
              <div className="flex items-center gap-2">
                <Switch id={`avail-${product.id}`} checked={product.available} onCheckedChange={v => handleToggle(product.id, "available", v)} />
                <Label htmlFor={`avail-${product.id}`} className="text-xs uppercase tracking-widest cursor-pointer whitespace-nowrap">Available</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id={`soon-${product.id}`} checked={product.comingSoon} onCheckedChange={v => handleToggle(product.id, "comingSoon", v)} />
                <Label htmlFor={`soon-${product.id}`} className="text-xs uppercase tracking-widest cursor-pointer whitespace-nowrap">Soon</Label>
              </div>
            </div>
          </AdminActions>
        </motion.div>
      ))}

      {/* Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="rounded-none border-border max-w-md">
          <DialogHeader><DialogTitle className="uppercase tracking-tighter font-black">{editId ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="uppercase tracking-widest text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Hoodie" className="rounded-none" />
            </div>
            <ImageUploader label="Product Image" value={form.image} onChange={url => setForm({ ...form, image: url })} />
            <div className="flex gap-6">
              <div className="flex items-center gap-2"><Switch id="p-avail" checked={form.available} onCheckedChange={v => setForm({ ...form, available: v, ...(v ? { comingSoon: false } : {}) })} /><Label htmlFor="p-avail" className="text-xs uppercase tracking-widest cursor-pointer">Available</Label></div>
              <div className="flex items-center gap-2"><Switch id="p-soon" checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v, ...(v ? { available: false } : {}) })} /><Label htmlFor="p-soon" className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label></div>
            </div>
            <Button type="submit" className="w-full rounded-none uppercase tracking-widest font-bold h-11" disabled={createProduct.isPending || updateProduct.isPending}>
              {editId ? "Save Changes" : "Create Product"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Fits Manager ───────────────────────────────────────────────────────────

function FitsManager() {
  const { data: fits } = useGetFits();
  const { data: products } = useGetProducts();
  const createFit = useCreateFit();
  const updateFit = useUpdateFit();
  const deleteFit = useDeleteFit();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", productId: "", available: true, comingSoon: false });

  const openAdd = () => {
    setEditId(null);
    setForm({ name: "", productId: products?.[0]?.id ?? "", available: true, comingSoon: false });
    setIsOpen(true);
  };

  const openEdit = (f: NonNullable<typeof fits>[0]) => {
    setEditId(f.id);
    setForm({ name: f.name, productId: f.productId, available: f.available, comingSoon: f.comingSoon });
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editId) {
      updateFit.mutate({ id: editId, data: { name: form.name, available: form.available, comingSoon: form.comingSoon } }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() }); toast({ title: "Fit updated" }); setIsOpen(false); }
      });
    } else {
      if (!form.productId) return;
      createFit.mutate({ data: form }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() }); toast({ title: "Fit created" }); setIsOpen(false); }
      });
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete fit "${name}"? This removes all its colors and sizes.`)) return;
    deleteFit.mutate({ id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() }); toast({ title: "Fit deleted" }); }
    });
  };

  const handleToggle = (id: string, field: "available" | "comingSoon", value: boolean) => {
    const other = field === "available" ? "comingSoon" : "available";
    updateFit.mutate({ id, data: { [field]: value, ...(value ? { [other]: false } : {}) } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() })
    });
  };

  const groupedFits = products?.map(p => ({
    product: p,
    fits: fits?.filter(f => f.productId === p.id) ?? [],
  })) ?? [];

  return (
    <div className="space-y-10">
      {/* Add card */}
      <motion.div
        onClick={openAdd}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="group relative h-[100px] border border-dashed border-border flex flex-col justify-center items-center cursor-pointer hover:border-foreground transition-colors"
      >
        <Plus className="w-6 h-6 text-muted-foreground group-hover:text-foreground transition-colors mb-1" />
        <span className="text-xs uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">Add Fit</span>
      </motion.div>

      {groupedFits.map(({ product, fits: productFits }) => (
        <div key={product.id} className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground border-b border-border pb-3">{product.name}</h3>
          <div className="space-y-4">
            {productFits.map((fit, i) => (
              <motion.div
                key={fit.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex gap-4 items-start"
              >
                {/* Fit card matching fits.tsx style */}
                <div className={`flex-1 p-6 border border-border flex flex-col justify-center items-center text-center min-h-[140px] ${fit.available ? "bg-card" : "opacity-60 bg-muted/20"}`}>
                  <h3 className="text-2xl font-bold uppercase tracking-tight mb-3">{fit.name}</h3>
                  {!fit.available && (
                    <span className="inline-block px-3 py-1 bg-muted text-muted-foreground text-xs font-medium tracking-widest uppercase">Coming Soon</span>
                  )}
                  {fit.available && (
                    <span className="inline-block px-3 py-1 bg-foreground text-background text-xs font-medium tracking-widest uppercase">Available</span>
                  )}
                </div>

                {/* Action buttons beside the card */}
                <AdminActions>
                  <Button variant="outline" className="rounded-none uppercase tracking-widest text-xs w-full justify-start" onClick={() => openEdit(fit)}>
                    <Edit className="w-3.5 h-3.5 mr-2" /> Edit
                  </Button>
                  <Button variant="outline" className="rounded-none uppercase tracking-widest text-xs w-full justify-start text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => handleDelete(fit.id, fit.name)}>
                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                  </Button>
                  <div className="border border-border p-2 space-y-2 mt-1">
                    <div className="flex items-center gap-2">
                      <Switch id={`f-avail-${fit.id}`} checked={fit.available} onCheckedChange={v => handleToggle(fit.id, "available", v)} />
                      <Label htmlFor={`f-avail-${fit.id}`} className="text-xs uppercase tracking-widest cursor-pointer whitespace-nowrap">Available</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id={`f-soon-${fit.id}`} checked={fit.comingSoon} onCheckedChange={v => handleToggle(fit.id, "comingSoon", v)} />
                      <Label htmlFor={`f-soon-${fit.id}`} className="text-xs uppercase tracking-widest cursor-pointer whitespace-nowrap">Soon</Label>
                    </div>
                  </div>
                </AdminActions>
              </motion.div>
            ))}
            {productFits.length === 0 && (
              <p className="text-xs text-muted-foreground uppercase tracking-widest">No fits yet — add one above</p>
            )}
          </div>
        </div>
      ))}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="rounded-none border-border max-w-md">
          <DialogHeader><DialogTitle className="uppercase tracking-tighter font-black">{editId ? "Edit Fit" : "Add Fit"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="uppercase tracking-widest text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Slim Fit" className="rounded-none" />
            </div>
            {!editId && (
              <div className="space-y-2">
                <Label className="uppercase tracking-widest text-xs">Product</Label>
                <select value={form.productId} onChange={e => setForm({ ...form, productId: e.target.value })} className="w-full h-10 rounded-none border border-input bg-background px-3 text-sm focus:outline-none focus:border-foreground">
                  {products?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-6">
              <div className="flex items-center gap-2"><Switch id="f-form-avail" checked={form.available} onCheckedChange={v => setForm({ ...form, available: v, ...(v ? { comingSoon: false } : {}) })} /><Label htmlFor="f-form-avail" className="text-xs uppercase tracking-widest cursor-pointer">Available</Label></div>
              <div className="flex items-center gap-2"><Switch id="f-form-soon" checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v, ...(v ? { available: false } : {}) })} /><Label htmlFor="f-form-soon" className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label></div>
            </div>
            <Button type="submit" className="w-full rounded-none uppercase tracking-widest font-bold h-11" disabled={createFit.isPending || updateFit.isPending}>
              {editId ? "Save Changes" : "Create Fit"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Colors Manager ─────────────────────────────────────────────────────────

function ColorsManager() {
  const { data: fits } = useGetFits();
  const { data: products } = useGetProducts();
  const [selectedFitId, setSelectedFitId] = useState<string>("");

  useEffect(() => {
    if (fits && fits.length > 0 && !selectedFitId) setSelectedFitId(fits[0].id);
  }, [fits, selectedFitId]);

  const { data: colors } = useGetColors(selectedFitId, {
    query: { enabled: !!selectedFitId, queryKey: getGetColorsQueryKey(selectedFitId) }
  });

  const addColor = useAddColor();
  const deleteColor = useDeleteColor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#0A0A0A");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColorName.trim() || !selectedFitId) return;
    addColor.mutate({ fitId: selectedFitId, data: { name: newColorName, hex: newColorHex } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetColorsQueryKey(selectedFitId) }); setNewColorName(""); toast({ title: "Color added" }); }
    });
  };

  const getFitLabel = (fitId: string) => {
    const fit = fits?.find(f => f.id === fitId);
    const product = products?.find(p => p.id === fit?.productId);
    return fit ? `${product?.name ?? ""} — ${fit.name}` : fitId;
  };

  return (
    <div className="space-y-10">
      {/* Fit selector */}
      <div className="flex flex-wrap gap-2">
        {fits?.map(fit => (
          <Button key={fit.id} variant={selectedFitId === fit.id ? "default" : "outline"} className="rounded-none uppercase tracking-widest text-xs h-8" onClick={() => setSelectedFitId(fit.id)}>
            {getFitLabel(fit.id)}
          </Button>
        ))}
      </div>

      {/* Add color form */}
      {selectedFitId && (
        <form onSubmit={handleAdd} className="border border-dashed border-border p-6 flex gap-4 items-end flex-wrap">
          <div className="space-y-2 flex-1 min-w-40">
            <Label className="uppercase tracking-widest text-xs">Color Name</Label>
            <Input value={newColorName} onChange={e => setNewColorName(e.target.value)} placeholder="e.g. Vintage Black" className="rounded-none h-10" />
          </div>
          <div className="space-y-2">
            <Label className="uppercase tracking-widest text-xs">Hex</Label>
            <div className="flex gap-2 items-center">
              <input type="color" value={newColorHex} onChange={e => setNewColorHex(e.target.value)} className="w-10 h-10 border border-input cursor-pointer bg-transparent" />
              <Input value={newColorHex} onChange={e => setNewColorHex(e.target.value)} className="w-24 rounded-none h-10 font-mono uppercase text-xs" />
            </div>
          </div>
          <Button type="submit" className="rounded-none h-10 uppercase tracking-widest text-xs" disabled={addColor.isPending}>
            <Plus className="w-4 h-4 mr-1" /> Add Color
          </Button>
        </form>
      )}

      {/* Color swatches — matching colors.tsx style */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
        {colors?.map((color, i) => (
          <motion.div
            key={color.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex gap-3 items-start"
          >
            {/* Color card matching colors.tsx */}
            <div className="flex-1 flex flex-col">
              <div className="aspect-square w-full border border-border mb-3" style={{ backgroundColor: color.hex }} />
              <p className="text-sm font-medium uppercase tracking-widest text-center">{color.name}</p>
              <p className="text-xs text-muted-foreground text-center font-mono">{color.hex}</p>
            </div>
            {/* Delete button beside */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10 mt-1 shrink-0"
              onClick={() => deleteColor.mutate({ fitId: selectedFitId, colorId: color.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetColorsQueryKey(selectedFitId) }) })}
            >
              <X className="w-4 h-4" />
            </Button>
          </motion.div>
        ))}
        {selectedFitId && !colors?.length && (
          <p className="text-xs text-muted-foreground uppercase tracking-widest col-span-full">No colors yet</p>
        )}
      </div>
    </div>
  );
}

// ─── Mockups Manager ─────────────────────────────────────────────────────────

interface BBox { x: number; y: number; width: number; height: number }

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface ResizingState {
  handle: ResizeHandle;
  startBbox: BBox;
  startMouse: { x: number; y: number };
}

const RESIZE_HANDLES: { id: ResizeHandle; cursor: string; style: React.CSSProperties }[] = [
  { id: "nw", cursor: "nw-resize", style: { top: -5, left: -5 } },
  { id: "n", cursor: "n-resize", style: { top: -5, left: "50%", transform: "translateX(-50%)" } },
  { id: "ne", cursor: "ne-resize", style: { top: -5, right: -5 } },
  { id: "e", cursor: "e-resize", style: { top: "50%", right: -5, transform: "translateY(-50%)" } },
  { id: "se", cursor: "se-resize", style: { bottom: -5, right: -5 } },
  { id: "s", cursor: "s-resize", style: { bottom: -5, left: "50%", transform: "translateX(-50%)" } },
  { id: "sw", cursor: "sw-resize", style: { bottom: -5, left: -5 } },
  { id: "w", cursor: "w-resize", style: { top: "50%", left: -5, transform: "translateY(-50%)" } },
];

function BoundingBoxEditor({
  image,
  bbox,
  onChange,
}: {
  image: string;
  bbox: BBox | null;
  onChange: (b: BBox) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [startPt, setStartPt] = useState({ x: 0, y: 0 });
  const [liveBbox, setLiveBbox] = useState<BBox | null>(bbox);
  const [resizing, setResizing] = useState<ResizingState | null>(null);

  const getPct = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    const pt = getPct(e.clientX, e.clientY);
    setStartPt(pt);
    setDrawing(true);
    setLiveBbox({ x: pt.x, y: pt.y, width: 0, height: 0 });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (drawing) {
      const pt = getPct(e.clientX, e.clientY);
      setLiveBbox({
        x: Math.min(startPt.x, pt.x),
        y: Math.min(startPt.y, pt.y),
        width: Math.abs(pt.x - startPt.x),
        height: Math.abs(pt.y - startPt.y),
      });
    } else if (resizing && liveBbox) {
      const pt = getPct(e.clientX, e.clientY);
      const dx = pt.x - resizing.startMouse.x;
      const dy = pt.y - resizing.startMouse.y;
      const sb = resizing.startBbox;
      let { x, y, width, height } = sb;
      switch (resizing.handle) {
        case "nw": x = sb.x + dx; y = sb.y + dy; width = sb.width - dx; height = sb.height - dy; break;
        case "n": y = sb.y + dy; height = sb.height - dy; break;
        case "ne": y = sb.y + dy; width = sb.width + dx; height = sb.height - dy; break;
        case "e": width = sb.width + dx; break;
        case "se": width = sb.width + dx; height = sb.height + dy; break;
        case "s": height = sb.height + dy; break;
        case "sw": x = sb.x + dx; width = sb.width - dx; height = sb.height + dy; break;
        case "w": x = sb.x + dx; width = sb.width - dx; break;
      }
      if (width < 2) { if (resizing.handle.includes("w")) x = sb.x + sb.width - 2; width = 2; }
      if (height < 2) { if (resizing.handle.includes("n")) y = sb.y + sb.height - 2; height = 2; }
      setLiveBbox({ x: Math.max(0, x), y: Math.max(0, y), width, height });
    }
  };

  const onMouseUp = () => {
    if (drawing) {
      setDrawing(false);
    } else if (resizing) {
      setResizing(null);
      if (liveBbox) onChange(liveBbox);
    }
  };

  const startResize = (e: React.MouseEvent, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    if (!liveBbox) return;
    const pt = getPct(e.clientX, e.clientY);
    setResizing({ handle, startBbox: { ...liveBbox }, startMouse: pt });
  };

  const displayBbox = liveBbox;
  const isInteracting = drawing || !!resizing;

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        Draw a box, then drag the handles on the edges to resize it
      </p>
      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden border border-border"
        style={{
          cursor: isInteracting ? "crosshair" : displayBbox ? "default" : "crosshair",
          aspectRatio: "3/4",
          backgroundImage:
            "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          backgroundColor: "#1a1a1a",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          if (drawing) { setDrawing(false); }
          if (resizing) { setResizing(null); if (liveBbox) onChange(liveBbox); }
        }}
      >
        <img src={image} alt="mockup" className="w-full h-full object-contain pointer-events-none" draggable={false} />
        {displayBbox && displayBbox.width > 0 && displayBbox.height > 0 && (
          <div
            style={{
              position: "absolute",
              left: `${displayBbox.x}%`,
              top: `${displayBbox.y}%`,
              width: `${displayBbox.width}%`,
              height: `${displayBbox.height}%`,
              border: "2px solid rgba(34,197,94,0.9)",
              background: "rgba(34,197,94,0.1)",
              pointerEvents: drawing ? "none" : "all",
            }}
          >
            <div className="absolute top-0 left-0 right-0 bottom-0 flex items-center justify-center pointer-events-none">
              <span className="text-white/70 text-xs uppercase tracking-widest font-mono">
                {displayBbox.width.toFixed(1)}% × {displayBbox.height.toFixed(1)}%
              </span>
            </div>
            {!drawing && RESIZE_HANDLES.map(h => (
              <div
                key={h.id}
                data-handle={h.id}
                onMouseDown={e => startResize(e, h.id)}
                style={{
                  position: "absolute",
                  width: 10,
                  height: 10,
                  background: "rgba(34,197,94,1)",
                  border: "1.5px solid rgba(255,255,255,0.9)",
                  cursor: h.cursor,
                  pointerEvents: "all",
                  ...h.style,
                }}
              />
            ))}
          </div>
        )}
      </div>
      {displayBbox && (
        <div className="grid grid-cols-4 gap-2 text-xs font-mono text-muted-foreground">
          <div>X: {displayBbox.x.toFixed(1)}%</div>
          <div>Y: {displayBbox.y.toFixed(1)}%</div>
          <div>W: {displayBbox.width.toFixed(1)}%</div>
          <div>H: {displayBbox.height.toFixed(1)}%</div>
        </div>
      )}
    </div>
  );
}

function MockupFilenameInput({ label, value, generatedFilename }: {
  label: string; value: string; generatedFilename: string;
}) {
  const PREFIX = "/api/uploads/mockups/";
  const expectedUrl = generatedFilename ? `${PREFIX}${generatedFilename}` : "";
  const currentFilename = value.startsWith(PREFIX) ? value.slice(PREFIX.length) : value;

  return (
    <div className="space-y-3">
      <Label className="uppercase tracking-widest text-xs">{label}</Label>
      <div className="border border-border bg-muted/10 p-4 space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Required file name</p>
        <p className="text-sm font-mono break-all text-foreground">{generatedFilename || "Select product, fit, and color first"}</p>
        {expectedUrl && (
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Put the PNG file in this folder and rename it exactly to the required file name:
            <span className="block font-mono break-all mt-1 text-foreground">artifacts/uploads/mockups/</span>
            The app will display it using this URL:
            <span className="block font-mono break-all mt-1">{expectedUrl}</span>
          </p>
        )}
      </div>
      {value && (
        <div className="flex items-start gap-3">
          <div className="w-16 h-16 border border-border overflow-hidden bg-muted/10 shrink-0">
            <img src={value} alt="preview" className="w-full h-full object-contain" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-[10px] text-muted-foreground font-mono break-all leading-relaxed">{value}</p>
            {currentFilename && generatedFilename && currentFilename !== generatedFilename && (
              <p className="text-[10px] text-amber-500 leading-relaxed">
                This saved path is using an older filename. Saving now will update it to the generated filename.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MockupsManager() {
  const { data: products } = useGetProducts();
  const { data: fits } = useGetFits();
  const { data: colors } = useGetColors("", { query: { enabled: false } });

  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedFitId, setSelectedFitId] = useState<string>("");
  const [selectedColorId, setSelectedColorId] = useState<string>("");
  const [activeSide, setActiveSide] = useState<"front" | "back">("front");
  const [showExportButton, setShowExportButton] = useState(() => localStorage.getItem("wearurway_show_export_button") !== "false");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setProduct, setFit, setColor, setSize } = useCustomizer();

  // Filtered fits/colors based on selection
  const filteredFits = fits?.filter(f => f.productId === selectedProductId) ?? [];

  const { data: filteredColors } = useGetColors(selectedFitId, {
    query: { enabled: !!selectedFitId, queryKey: getGetColorsQueryKey(selectedFitId) }
  });

  const { data: fitSizes } = useGetSizes(selectedFitId, {
    query: { enabled: !!selectedFitId, queryKey: getGetSizesQueryKey(selectedFitId) }
  });

  const handlePreviewInDesigner = () => {
    const product = products?.find(p => p.id === selectedProductId);
    const fit = fits?.find(f => f.id === selectedFitId);
    const color = filteredColors?.find(c => c.id === selectedColorId);
    const size = fitSizes?.[0];
    if (!product || !fit || !color || !size) {
      toast({ title: "Select a full combination first", description: "Product, fit, color, and at least one size must exist." });
      return;
    }
    setProduct(product);
    setFit(fit);
    setColor(color);
    setSize(size);
    setLocation("/design?admin=1");
  };

  useEffect(() => {
    if (products && products.length > 0 && !selectedProductId) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  useEffect(() => {
    if (filteredFits.length > 0 && (!selectedFitId || !filteredFits.find(f => f.id === selectedFitId))) {
      setSelectedFitId(filteredFits[0].id);
    }
  }, [filteredFits, selectedFitId]);

  useEffect(() => {
    if (filteredColors && filteredColors.length > 0 && (!selectedColorId || !filteredColors.find(c => c.id === selectedColorId))) {
      setSelectedColorId(filteredColors[0].id);
    }
  }, [filteredColors, selectedColorId]);

  const mockupParams = selectedProductId && selectedFitId && selectedColorId
    ? { productId: selectedProductId, fitId: selectedFitId, colorId: selectedColorId }
    : null;

  const { data: mockup, isLoading: mockupLoading } = useGetMockup(
    mockupParams ?? { productId: "", fitId: "", colorId: "" },
    { query: { enabled: !!mockupParams, queryKey: getGetMockupQueryKey(mockupParams ?? undefined) } }
  );

  const saveMockup = useSaveMockup();

  // Local state for the mockup being edited
  const [frontImage, setFrontImage] = useState("");
  const [frontBbox, setFrontBbox] = useState<BBox | null>(null);
  const [backImage, setBackImage] = useState("");
  const [backBbox, setBackBbox] = useState<BBox | null>(null);
  const [showSaveDesignButton, setShowSaveDesignButton] = useState(true);

  // Sync bboxes from fetched mockup when selection changes (images come from generated filenames)
  useEffect(() => {
    setFrontBbox(mockup?.front?.boundingBox ?? null);
    setBackBbox(mockup?.back?.boundingBox ?? null);
    setShowSaveDesignButton(mockup?.showSaveDesignButton !== false);
  }, [mockup]);

  const productName = products?.find(p => p.id === selectedProductId)?.name ?? "";
  const fitName = fits?.find(f => f.id === selectedFitId)?.name ?? "";
  const colorName = filteredColors?.find(c => c.id === selectedColorId)?.name ?? "";
  const colorHex = filteredColors?.find(c => c.id === selectedColorId)?.hex ?? "";
  const frontGeneratedFilename = buildMockupFilename(productName, fitName, colorName, "front");
  const backGeneratedFilename = buildMockupFilename(productName, fitName, colorName, "back");
  const activeGeneratedFilename = activeSide === "front" ? frontGeneratedFilename : backGeneratedFilename;
  const frontGeneratedImage = frontGeneratedFilename ? `/api/uploads/mockups/${frontGeneratedFilename}` : "";
  const backGeneratedImage = backGeneratedFilename ? `/api/uploads/mockups/${backGeneratedFilename}` : "";

  useEffect(() => {
    setFrontImage(frontGeneratedImage);
    setBackImage(backGeneratedImage);
  }, [frontGeneratedImage, backGeneratedImage]);

  const handleSave = () => {
    if (!mockupParams) return;
    saveMockup.mutate({
      data: {
        ...mockupParams,
        front: {
          image: frontGeneratedImage || frontImage || undefined,
          boundingBox: frontBbox ?? undefined,
        },
        back: {
          image: backGeneratedImage || backImage || undefined,
          boundingBox: backBbox ?? undefined,
        },
        showSaveDesignButton,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMockupQueryKey(mockupParams) });
        toast({ title: "Mockup saved" });
      }
    });
  };

  const currentImage = activeSide === "front" ? frontImage : backImage;
  const currentBbox = activeSide === "front" ? frontBbox : backBbox;
  const setCurrentBbox = activeSide === "front" ? setFrontBbox : setBackBbox;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Select Combination</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Product */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest">Product</Label>
            <select
              value={selectedProductId}
              onChange={e => { setSelectedProductId(e.target.value); setSelectedFitId(""); setSelectedColorId(""); }}
              className="w-full h-10 rounded-none border border-input bg-background px-3 text-sm focus:outline-none focus:border-foreground"
            >
              {products?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {/* Fit */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest">Fit</Label>
            <select
              value={selectedFitId}
              onChange={e => { setSelectedFitId(e.target.value); setSelectedColorId(""); }}
              className="w-full h-10 rounded-none border border-input bg-background px-3 text-sm focus:outline-none focus:border-foreground"
              disabled={!filteredFits.length}
            >
              {filteredFits.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {/* Color */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest">Color</Label>
            <div className="flex gap-2">
              {colorHex && <div className="w-10 h-10 border border-border shrink-0" style={{ backgroundColor: colorHex }} />}
              <select
                value={selectedColorId}
                onChange={e => setSelectedColorId(e.target.value)}
                className="flex-1 h-10 rounded-none border border-input bg-background px-3 text-sm focus:outline-none focus:border-foreground"
                disabled={!filteredColors?.length}
              >
                {filteredColors?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {selectedProductId && selectedFitId && selectedColorId && (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-widest">
            <span>Editing mockup for:</span>
            <span className="font-bold text-foreground">{productName} / {fitName} / {colorName}</span>
          </div>
        )}
      </div>

      {mockupParams && (
        <>
          {/* Front / Back tabs */}
          <div className="flex gap-0 border border-border w-fit">
            {(["front", "back"] as const).map(s => (
              <button
                key={s}
                onClick={() => setActiveSide(s)}
                className={`px-8 py-2 text-xs uppercase tracking-widest font-medium transition-colors ${activeSide === s ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-muted/20"}`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: mockup image */}
            <div className="space-y-4">
              <MockupFilenameInput
                label={`${activeSide === "front" ? "Front" : "Back"} Mockup Image`}
                value={currentImage}
                generatedFilename={activeGeneratedFilename}
              />
              {!currentImage && (
                <div className="border border-dashed border-border aspect-[3/4] flex flex-col items-center justify-center text-muted-foreground gap-3">
                  <span className="text-xs uppercase tracking-widest">Select a full combination first</span>
                  <span className="text-xs text-muted-foreground/60">Then upload the image using the generated filename</span>
                </div>
              )}
            </div>

            {/* Right: summary */}
            <div className="space-y-6">
              <div className="border border-border p-6 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-widest">Summary</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground uppercase tracking-widest">Front image</span>
                    <span className={frontImage ? "text-foreground" : "text-muted-foreground"}>{frontImage ? "Uploaded" : "Missing"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground uppercase tracking-widest">Back image</span>
                    <span className={backImage ? "text-foreground" : "text-muted-foreground"}>{backImage ? "Uploaded" : "Missing"}</span>
                  </div>
                </div>
              </div>

              <div className="border border-border p-4 space-y-3">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Designer Display</p>
                <div className="flex items-center justify-between">
                  <Label htmlFor="toggle-export-button" className="text-xs uppercase tracking-widest cursor-pointer">Show Export Image Button</Label>
                  <Switch
                    id="toggle-export-button"
                    checked={showExportButton}
                    onCheckedChange={v => {
                      setShowExportButton(v);
                      localStorage.setItem("wearurway_show_export_button", v ? "true" : "false");
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="toggle-save-design-button" className="text-xs uppercase tracking-widest cursor-pointer">Show Save Design Button</Label>
                  <Switch
                    id="toggle-save-design-button"
                    checked={showSaveDesignButton}
                    onCheckedChange={setShowSaveDesignButton}
                  />
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full rounded-none uppercase tracking-widest font-bold h-12"
                onClick={handlePreviewInDesigner}
                disabled={!mockupParams}
              >
                Preview in Designer →
              </Button>

              <Button
                className="w-full rounded-none uppercase tracking-widest font-bold h-12"
                onClick={handleSave}
                disabled={saveMockup.isPending || !mockupParams}
              >
                {saveMockup.isPending ? "Saving..." : "Save Mockup"}
              </Button>
            </div>
          </div>
        </>
      )}

      {!mockupParams && (
        <div className="border border-dashed border-border p-12 text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Select a product, fit, and color above to manage its mockup</p>
        </div>
      )}
    </div>
  );
}

// ─── Sizes Manager ───────────────────────────────────────────────────────────

function SizesManager() {
  const { data: fits } = useGetFits();
  const { data: products } = useGetProducts();
  const [selectedFitId, setSelectedFitId] = useState<string>("");

  useEffect(() => {
    if (fits && fits.length > 0 && !selectedFitId) setSelectedFitId(fits[0].id);
  }, [fits, selectedFitId]);

  const { data: sizes } = useGetSizes(selectedFitId, {
    query: { enabled: !!selectedFitId, queryKey: getGetSizesQueryKey(selectedFitId) }
  });

  const addSize = useAddSize();
  const updateSize = useUpdateSize();
  const deleteSize = useDeleteSize();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const emptyForm = { name: "", realWidth: 0, realHeight: 0, available: true, comingSoon: false, heightMin: 0, heightMax: 0, weightMin: 0, weightMax: 0 };
  const [isOpen, setIsOpen] = useState(false);
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openAdd = () => { setEditingSizeId(null); setForm(emptyForm); setIsOpen(true); };
  const openEdit = (size: NonNullable<typeof sizes>[0]) => {
    setEditingSizeId(size.id);
    setForm({
      name: size.name,
      realWidth: size.realWidth,
      realHeight: size.realHeight,
      available: size.available ?? true,
      comingSoon: size.comingSoon ?? false,
      heightMin: size.heightMin ?? 0,
      heightMax: size.heightMax ?? 0,
      weightMin: size.weightMin ?? 0,
      weightMax: size.weightMax ?? 0,
    });
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editingSizeId) {
      updateSize.mutate({ fitId: selectedFitId, sizeId: editingSizeId, data: form }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) }); toast({ title: "Size updated" }); setIsOpen(false); }
      });
    } else {
      addSize.mutate({ fitId: selectedFitId, data: form }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) }); toast({ title: "Size added" }); setIsOpen(false); }
      });
    }
  };

  const handleToggle = (sizeId: string, field: "available" | "comingSoon", value: boolean) => {
    const other = field === "available" ? "comingSoon" : "available";
    updateSize.mutate({ fitId: selectedFitId, sizeId, data: { [field]: value, ...(value ? { [other]: false } : {}) } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) })
    });
  };

  const getFitLabel = (fitId: string) => {
    const fit = fits?.find(f => f.id === fitId);
    const product = products?.find(p => p.id === fit?.productId);
    return fit ? `${product?.name ?? ""} — ${fit.name}` : fitId;
  };

  return (
    <div className="space-y-10">
      {/* Fit selector */}
      <div className="flex flex-wrap gap-2">
        {fits?.map(fit => (
          <Button key={fit.id} variant={selectedFitId === fit.id ? "default" : "outline"} className="rounded-none uppercase tracking-widest text-xs h-8" onClick={() => setSelectedFitId(fit.id)}>
            {getFitLabel(fit.id)}
          </Button>
        ))}
      </div>

      {/* Add size card */}
      {selectedFitId && (
        <motion.div
          onClick={openAdd}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="group h-[100px] border border-dashed border-border flex flex-col justify-center items-center cursor-pointer hover:border-foreground transition-colors"
        >
          <Plus className="w-6 h-6 text-muted-foreground group-hover:text-foreground transition-colors mb-1" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">Add Size</span>
        </motion.div>
      )}

      {/* Size cards — matching sizes.tsx / fits.tsx style */}
      <div className="space-y-4">
        {sizes?.map((size, i) => (
          <motion.div
            key={size.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex gap-4 items-start"
          >
            {/* Size card matching sizes.tsx */}
            <div className={`flex-1 p-6 border border-border flex flex-col justify-center items-center text-center min-h-[160px] ${size.available !== false ? "bg-card" : "opacity-60 bg-muted/20"}`}>
              <h3 className="text-2xl font-bold uppercase tracking-tight mb-2">{size.name}</h3>
              <p className="text-sm font-mono text-foreground mb-2">{size.realWidth} x {size.realHeight} CM</p>
              <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                {(size.heightMin || size.heightMax) ? <span>{size.heightMin} ~ {size.heightMax} cm tall</span> : null}
                {(size.weightMin || size.weightMax) ? <span>{size.weightMin} ~ {size.weightMax} kg</span> : null}
              </div>
              {size.comingSoon && (
                <span className="mt-3 inline-block px-3 py-1 bg-muted text-muted-foreground text-xs font-medium tracking-widest uppercase">Coming Soon</span>
              )}
            </div>

            {/* Action buttons beside */}
            <AdminActions>
              <Button variant="outline" className="rounded-none uppercase tracking-widest text-xs w-full justify-start" onClick={() => openEdit(size)}>
                <Edit className="w-3.5 h-3.5 mr-2" /> Edit
              </Button>
              <Button variant="outline" className="rounded-none uppercase tracking-widest text-xs w-full justify-start text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => deleteSize.mutate({ fitId: selectedFitId, sizeId: size.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) }) })}>
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
              </Button>
              <div className="border border-border p-2 space-y-2 mt-1">
                <div className="flex items-center gap-2">
                  <Switch id={`sz-avail-${size.id}`} checked={size.available ?? true} onCheckedChange={v => handleToggle(size.id, "available", v)} />
                  <Label htmlFor={`sz-avail-${size.id}`} className="text-xs uppercase tracking-widest cursor-pointer whitespace-nowrap">Available</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id={`sz-soon-${size.id}`} checked={size.comingSoon ?? false} onCheckedChange={v => handleToggle(size.id, "comingSoon", v)} />
                  <Label htmlFor={`sz-soon-${size.id}`} className="text-xs uppercase tracking-widest cursor-pointer whitespace-nowrap">Soon</Label>
                </div>
              </div>
            </AdminActions>
          </motion.div>
        ))}
        {selectedFitId && !sizes?.length && (
          <p className="text-xs text-muted-foreground uppercase tracking-widest">No sizes yet</p>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="rounded-none border-border max-w-md">
          <DialogHeader><DialogTitle className="uppercase tracking-tighter font-black">{editingSizeId ? "Edit Size" : "Add Size"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="uppercase tracking-widest text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Small" className="rounded-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="uppercase tracking-widest text-xs">Width (cm)</Label>
                <Input type="number" value={form.realWidth || ""} onChange={e => setForm({ ...form, realWidth: Number(e.target.value) })} className="rounded-none" placeholder="48" />
              </div>
              <div className="space-y-2">
                <Label className="uppercase tracking-widest text-xs">Height (cm)</Label>
                <Input type="number" value={form.realHeight || ""} onChange={e => setForm({ ...form, realHeight: Number(e.target.value) })} className="rounded-none" placeholder="66" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-widest text-xs">Person Height Range (cm)</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input type="number" value={form.heightMin || ""} onChange={e => setForm({ ...form, heightMin: Number(e.target.value) })} className="rounded-none" placeholder="Min e.g. 175" />
                <Input type="number" value={form.heightMax || ""} onChange={e => setForm({ ...form, heightMax: Number(e.target.value) })} className="rounded-none" placeholder="Max e.g. 180" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-widest text-xs">Person Weight Range (kg)</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input type="number" value={form.weightMin || ""} onChange={e => setForm({ ...form, weightMin: Number(e.target.value) })} className="rounded-none" placeholder="Min e.g. 75" />
                <Input type="number" value={form.weightMax || ""} onChange={e => setForm({ ...form, weightMax: Number(e.target.value) })} className="rounded-none" placeholder="Max e.g. 80" />
              </div>
            </div>
            <div className="flex gap-6">
              <div className="flex items-center gap-2"><Switch id="sz-form-avail" checked={form.available} onCheckedChange={v => setForm({ ...form, available: v, ...(v ? { comingSoon: false } : {}) })} /><Label htmlFor="sz-form-avail" className="text-xs uppercase tracking-widest cursor-pointer">Available</Label></div>
              <div className="flex items-center gap-2"><Switch id="sz-form-soon" checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v, ...(v ? { available: false } : {}) })} /><Label htmlFor="sz-form-soon" className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label></div>
            </div>
            <Button type="submit" className="w-full rounded-none uppercase tracking-widest font-bold h-11" disabled={addSize.isPending || updateSize.isPending}>
              {editingSizeId ? "Save Changes" : "Add Size"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderSettingsManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = useGetAdminOrderSettings();
  const updateSettings = useUpdateAdminOrderSettings();
  const [form, setForm] = useState({
    shippingCompanyName: "Wasslaha Standard",
    shippingDescription: "Delivered in 2–3 working days",
    shippingPrice: 85,
    frontOnlyPrice: 550,
    frontBackPrice: 700,
    instaPayPhone: "01069383482",
    telegramChatId: "",
    telegramBotToken: "",
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      shippingCompanyName: settings.shippingCompanyName,
      shippingDescription: settings.shippingDescription,
      shippingPrice: settings.shippingPrice,
      frontOnlyPrice: settings.frontOnlyPrice,
      frontBackPrice: settings.frontBackPrice,
      instaPayPhone: settings.instaPayPhone,
      telegramChatId: settings.telegramChatId ?? "",
      telegramBotToken: settings.telegramBotToken ?? "",
    });
  }, [settings]);

  const setText = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
  };

  const setNumber = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [key]: Number(e.target.value) }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate({ data: form }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAdminOrderSettingsQueryKey() });
        toast({ title: "Settings saved" });
      },
      onError: () => toast({ title: "Settings failed", description: "Could not save order settings." }),
    });
  };

  return (
    <form onSubmit={handleSave} className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Checkout Settings</h2>
        <div className="border border-border p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest">Shipping Company Name</Label>
              <Input value={form.shippingCompanyName} onChange={setText("shippingCompanyName")} className="rounded-none" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest">Shipping Price</Label>
              <Input type="number" value={form.shippingPrice} onChange={setNumber("shippingPrice")} className="rounded-none" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest">Shipping Description</Label>
            <Input value={form.shippingDescription} onChange={setText("shippingDescription")} className="rounded-none" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest">Price for Front Only</Label>
              <Input type="number" value={form.frontOnlyPrice} onChange={setNumber("frontOnlyPrice")} className="rounded-none" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest">Price for Front + Back</Label>
              <Input type="number" value={form.frontBackPrice} onChange={setNumber("frontBackPrice")} className="rounded-none" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest">InstaPay Phone Number</Label>
            <Input value={form.instaPayPhone} onChange={setText("instaPayPhone")} className="rounded-none" />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Telegram Settings</h2>
        <div className="border border-border p-6 space-y-5">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest">Telegram CHAT_ID</Label>
            <Input value={form.telegramChatId} onChange={setText("telegramChatId")} className="rounded-none" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest">Telegram BOT_TOKEN</Label>
            <Input type="password" value={form.telegramBotToken} onChange={setText("telegramBotToken")} className="rounded-none" />
          </div>
        </div>
      </div>

      <Button type="submit" className="rounded-none uppercase tracking-widest font-bold h-12 px-8" disabled={updateSettings.isPending}>
        {updateSettings.isPending ? "Saving..." : "Save Settings"}
      </Button>
    </form>
  );
}

// ─── Fonts Manager ───────────────────────────────────────────────────────────
function FontsManager() {
  return (
    <div className="space-y-10 max-w-2xl">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Font Files</h2>

        <div className="border border-border p-6 space-y-5">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Fonts folder path</p>
            <p className="font-mono text-sm bg-muted/20 px-4 py-3 border border-border break-all select-all">
              artifacts/wearurway/public/fonts/
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Config file</p>
            <p className="font-mono text-sm bg-muted/20 px-4 py-3 border border-border break-all select-all">
              artifacts/wearurway/src/config/fonts.ts
            </p>
          </div>

          <div className="border-t border-border pt-5 space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest">How to add a font</p>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Copy your <span className="font-mono font-bold text-foreground">.woff2</span> file into the fonts folder above</li>
              <li>Open <span className="font-mono text-foreground">config/fonts.ts</span> and add a new entry to the <span className="font-mono text-foreground">CUSTOM_FONTS</span> array</li>
            </ol>
            <p className="text-xs font-bold uppercase tracking-widest mt-4">How to remove a font</p>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Delete the file from the fonts folder</li>
              <li>Remove its entry from <span className="font-mono text-foreground">config/fonts.ts</span></li>
            </ol>
          </div>

          <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-xs text-amber-600 dark:text-amber-400 uppercase tracking-widest font-medium">
            Font files must use the <span className="font-mono font-bold">.woff2</span> extension — other formats will not work
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Active Fonts ({CUSTOM_FONTS.length})
        </h2>
        <div className="border border-border divide-y divide-border">
          {CUSTOM_FONTS.map(font => (
            <div key={font.family} className="flex items-center justify-between px-5 py-3 gap-4">
              <span className="text-sm font-medium truncate">{font.name}</span>
              <span className="font-mono text-xs text-muted-foreground shrink-0">{font.filename}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
