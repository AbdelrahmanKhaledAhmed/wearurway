import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetAdminMe,
  useGetProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getGetProductsQueryKey,
  useGetFits, useCreateFit, useUpdateFit, useDeleteFit, getGetFitsQueryKey,
  useGetColors, useAddColor, useDeleteColor, getGetColorsQueryKey,
  useGetSizes, useAddSize, useUpdateSize, useDeleteSize, getGetSizesQueryKey,
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

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { data: adminMe, isLoading: isAuthLoading } = useGetAdminMe();
  const logoutMutation = useAdminLogout();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthLoading && adminMe && !adminMe.authenticated) {
      setLocation("/admin");
    }
  }, [adminMe, isAuthLoading, setLocation]);

  const handleLogout = () => {
    logoutMutation.mutate({}, {
      onSuccess: () => {
        localStorage.removeItem("wearurway_admin_token");
        queryClient.clear();
        setLocation("/admin");
      }
    });
  };

  if (isAuthLoading) {
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
            {["products", "fits", "colors", "sizes"].map(tab => (
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
        </Tabs>
      </motion.div>
    </div>
  );
}

// ─── Image Upload Helper ────────────────────────────────────────────────────

function ImageUploader({ value, onChange, label = "Image" }: {
  value: string; onChange: (url: string) => void; label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("wearurway_admin_token");
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as { url: string };
      onChange(data.url);
    } catch { /* silent */ }
    finally { setUploading(false); }
  };

  return (
    <div className="space-y-2">
      <Label className="uppercase tracking-widest text-xs">{label}</Label>
      <div className="flex gap-2 items-center">
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder="/api/uploads/image.png" className="rounded-none h-10 flex-1" />
        <Button type="button" variant="outline" className="rounded-none h-10 whitespace-nowrap" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Upload className="w-4 h-4 mr-2" />{uploading ? "Uploading..." : "Upload"}
        </Button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </div>
      {value && <div className="w-16 h-16 border border-border overflow-hidden bg-muted/10"><img src={value} alt="preview" className="w-full h-full object-contain" /></div>}
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
    updateProduct.mutate({ id, data: { [field]: value } }, {
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
              <div className="flex items-center gap-2"><Switch id="p-avail" checked={form.available} onCheckedChange={v => setForm({ ...form, available: v })} /><Label htmlFor="p-avail" className="text-xs uppercase tracking-widest cursor-pointer">Available</Label></div>
              <div className="flex items-center gap-2"><Switch id="p-soon" checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v })} /><Label htmlFor="p-soon" className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label></div>
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
    updateFit.mutate({ id, data: { [field]: value } }, {
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
              <div className="flex items-center gap-2"><Switch id="f-form-avail" checked={form.available} onCheckedChange={v => setForm({ ...form, available: v })} /><Label htmlFor="f-form-avail" className="text-xs uppercase tracking-widest cursor-pointer">Available</Label></div>
              <div className="flex items-center gap-2"><Switch id="f-form-soon" checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v })} /><Label htmlFor="f-form-soon" className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label></div>
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

  const [isOpen, setIsOpen] = useState(false);
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", realWidth: 0, realHeight: 0, image: "" });

  const openAdd = () => { setEditingSizeId(null); setForm({ name: "", realWidth: 0, realHeight: 0, image: "" }); setIsOpen(true); };
  const openEdit = (size: NonNullable<typeof sizes>[0]) => {
    setEditingSizeId(size.id);
    setForm({ name: size.name, realWidth: size.realWidth, realHeight: size.realHeight, image: size.image ?? "" });
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
          className="group h-[120px] border border-dashed border-border flex flex-col justify-center items-center cursor-pointer hover:border-foreground transition-colors"
        >
          <Plus className="w-6 h-6 text-muted-foreground group-hover:text-foreground transition-colors mb-1" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">Add Size</span>
        </motion.div>
      )}

      {/* Size cards — similar to sizes.tsx but with buttons beside */}
      <div className="space-y-4">
        {sizes?.map((size, i) => (
          <motion.div
            key={size.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex gap-4 items-start"
          >
            {/* Size card */}
            <div className="flex-1 border border-border p-6 flex gap-6 items-center bg-card">
              <div className="w-24 h-24 border border-border bg-muted/10 flex items-center justify-center overflow-hidden shrink-0">
                {size.image
                  ? <img src={size.image} alt={size.name} className="w-full h-full object-contain" />
                  : <span className="text-xs text-muted-foreground uppercase tracking-widest text-center px-1">No Image</span>
                }
              </div>
              <div>
                <h3 className="text-3xl font-bold uppercase tracking-tight">{size.name}</h3>
                <p className="text-sm font-mono text-muted-foreground mt-1">{size.realWidth}W × {size.realHeight}H cm</p>
              </div>
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
            <ImageUploader label="Size Chart Image" value={form.image} onChange={url => setForm({ ...form, image: url })} />
            <Button type="submit" className="w-full rounded-none uppercase tracking-widest font-bold h-11" disabled={addSize.isPending || updateSize.isPending}>
              {editingSizeId ? "Save Changes" : "Add Size"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
