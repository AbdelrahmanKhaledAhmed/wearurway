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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Edit, LogOut, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
        <div className="text-sm uppercase tracking-widest text-muted-foreground animate-pulse">Verifying...</div>
      </div>
    );
  }

  if (!adminMe?.authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen pt-20 px-4 md:px-8 max-w-6xl mx-auto pb-24">
      <div className="flex justify-between items-center mb-10 pt-6 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase">Admin Dashboard</h1>
          <p className="text-muted-foreground text-xs uppercase tracking-widest mt-1">Full Control Panel</p>
        </div>
        <Button
          variant="outline"
          className="rounded-none uppercase tracking-widest text-xs"
          onClick={handleLogout}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 mr-2" /> Logout
        </Button>
      </div>

      <Tabs defaultValue="products" className="w-full">
        <TabsList className="mb-8 rounded-none border-b border-border bg-transparent h-auto p-0 flex space-x-8 overflow-x-auto justify-start w-full">
          {["products", "fits", "colors", "sizes"].map(tab => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent pb-3 uppercase tracking-widest text-xs px-0"
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
    </div>
  );
}

// ─── Image Upload Helper ────────────────────────────────────────────────────

function ImageUploader({ value, onChange, label = "Image" }: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
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
    } catch {
      // silent fail
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="uppercase tracking-widest text-xs">{label}</Label>
      <div className="flex gap-2 items-start">
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="/api/uploads/image.png"
          className="rounded-none h-10 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          className="rounded-none h-10 whitespace-nowrap"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="w-4 h-4 mr-2" />
          {uploading ? "Uploading..." : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {value && (
        <div className="w-20 h-20 border border-border overflow-hidden bg-muted/10">
          <img src={value} alt="preview" className="w-full h-full object-contain" onError={() => {}} />
        </div>
      )}
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
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
          toast({ title: "Product updated" });
          setIsOpen(false);
        }
      });
    } else {
      createProduct.mutate({ data: form }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
          toast({ title: "Product created" });
          setIsOpen(false);
        }
      });
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This removes all its fits, colors, and sizes.`)) return;
    deleteProduct.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() });
        toast({ title: "Product deleted" });
      }
    });
  };

  const handleToggle = (id: string, field: "available" | "comingSoon", value: boolean) => {
    updateProduct.mutate({ id, data: { [field]: value } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() })
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground uppercase tracking-widest">{products?.length ?? 0} products</p>
        <Button onClick={openAdd} className="rounded-none uppercase tracking-widest text-xs">
          <Plus className="w-4 h-4 mr-2" /> Add Product
        </Button>
      </div>

      <div className="grid gap-4">
        {products?.map(product => (
          <Card key={product.id} className="rounded-none border-border">
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                {product.image && (
                  <div className="w-16 h-16 border border-border overflow-hidden shrink-0 bg-muted/10">
                    <img src={product.image} alt={product.name} className="w-full h-full object-contain" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold uppercase tracking-tight">{product.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">ID: {product.id}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(product)} className="h-8 w-8">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id, product.name)} className="h-8 w-8 text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-6 mt-3">
                    <div className="flex items-center gap-2">
                      <Switch id={`avail-${product.id}`} checked={product.available} onCheckedChange={v => handleToggle(product.id, "available", v)} />
                      <Label htmlFor={`avail-${product.id}`} className="text-xs uppercase tracking-widest cursor-pointer">Available</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id={`soon-${product.id}`} checked={product.comingSoon} onCheckedChange={v => handleToggle(product.id, "comingSoon", v)} />
                      <Label htmlFor={`soon-${product.id}`} className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="rounded-none border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-tighter font-black">{editId ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="uppercase tracking-widest text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Hoodie" className="rounded-none" />
            </div>
            <ImageUploader label="Product Image" value={form.image} onChange={url => setForm({ ...form, image: url })} />
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <Switch id="p-avail" checked={form.available} onCheckedChange={v => setForm({ ...form, available: v })} />
                <Label htmlFor="p-avail" className="text-xs uppercase tracking-widest cursor-pointer">Available</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="p-soon" checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v })} />
                <Label htmlFor="p-soon" className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label>
              </div>
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
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() });
          toast({ title: "Fit updated" });
          setIsOpen(false);
        }
      });
    } else {
      if (!form.productId) return;
      createFit.mutate({ data: form }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() });
          toast({ title: "Fit created" });
          setIsOpen(false);
        }
      });
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete fit "${name}"? This removes all its colors and sizes.`)) return;
    deleteFit.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() });
        toast({ title: "Fit deleted" });
      }
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground uppercase tracking-widest">{fits?.length ?? 0} fits total</p>
        <Button onClick={openAdd} className="rounded-none uppercase tracking-widest text-xs" disabled={!products?.length}>
          <Plus className="w-4 h-4 mr-2" /> Add Fit
        </Button>
      </div>

      {groupedFits.map(({ product, fits: productFits }) => (
        <div key={product.id} className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground border-b border-border pb-2">{product.name}</h3>
          <div className="grid gap-3">
            {productFits.map(fit => (
              <Card key={fit.id} className="rounded-none border-border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <h4 className="font-bold uppercase tracking-tight">{fit.name}</h4>
                      <p className="text-xs text-muted-foreground font-mono">ID: {fit.id}</p>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Switch id={`f-avail-${fit.id}`} checked={fit.available} onCheckedChange={v => handleToggle(fit.id, "available", v)} />
                        <Label htmlFor={`f-avail-${fit.id}`} className="text-xs uppercase tracking-widest cursor-pointer">Available</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch id={`f-soon-${fit.id}`} checked={fit.comingSoon} onCheckedChange={v => handleToggle(fit.id, "comingSoon", v)} />
                        <Label htmlFor={`f-soon-${fit.id}`} className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(fit)} className="h-8 w-8">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(fit.id, fit.name)} className="h-8 w-8 text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {productFits.length === 0 && (
              <p className="text-xs text-muted-foreground uppercase tracking-widest">No fits — add one above</p>
            )}
          </div>
        </div>
      ))}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="rounded-none border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-tighter font-black">{editId ? "Edit Fit" : "Add Fit"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="uppercase tracking-widest text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Slim Fit" className="rounded-none" />
            </div>
            {!editId && (
              <div className="space-y-2">
                <Label className="uppercase tracking-widest text-xs">Product</Label>
                <select
                  value={form.productId}
                  onChange={e => setForm({ ...form, productId: e.target.value })}
                  className="w-full h-10 rounded-none border border-input bg-background px-3 text-sm focus:outline-none focus:border-foreground"
                >
                  {products?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <Switch id="f-form-avail" checked={form.available} onCheckedChange={v => setForm({ ...form, available: v })} />
                <Label htmlFor="f-form-avail" className="text-xs uppercase tracking-widest cursor-pointer">Available</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="f-form-soon" checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v })} />
                <Label htmlFor="f-form-soon" className="text-xs uppercase tracking-widest cursor-pointer">Coming Soon</Label>
              </div>
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
    if (fits && fits.length > 0 && !selectedFitId) {
      setSelectedFitId(fits[0].id);
    }
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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetColorsQueryKey(selectedFitId) });
        setNewColorName("");
        toast({ title: "Color added" });
      }
    });
  };

  const getFitLabel = (fitId: string) => {
    const fit = fits?.find(f => f.id === fitId);
    const product = products?.find(p => p.id === fit?.productId);
    return fit ? `${product?.name ?? ""} — ${fit.name}` : fitId;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        {fits?.map(fit => (
          <Button key={fit.id} variant={selectedFitId === fit.id ? "default" : "outline"} className="rounded-none uppercase tracking-widest text-xs h-8" onClick={() => setSelectedFitId(fit.id)}>
            {getFitLabel(fit.id)}
          </Button>
        ))}
      </div>

      {selectedFitId && (
        <Card className="rounded-none border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-widest font-bold">Add Color to {getFitLabel(selectedFitId)}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="flex gap-3 items-end flex-wrap">
              <div className="space-y-1 flex-1 min-w-40">
                <Label className="text-xs uppercase tracking-widest">Name</Label>
                <Input value={newColorName} onChange={e => setNewColorName(e.target.value)} placeholder="e.g. Vintage Black" className="rounded-none h-10" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-widest">Color</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={newColorHex} onChange={e => setNewColorHex(e.target.value)} className="w-10 h-10 border border-input cursor-pointer bg-transparent" />
                  <Input value={newColorHex} onChange={e => setNewColorHex(e.target.value)} className="w-24 rounded-none h-10 font-mono uppercase text-xs" placeholder="#000000" />
                </div>
              </div>
              <Button type="submit" className="rounded-none h-10 uppercase tracking-widest text-xs" disabled={addColor.isPending}>
                <Plus className="w-4 h-4 mr-1" /> Add
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {colors?.map(color => (
          <div key={color.id} className="border border-border group">
            <div className="aspect-square" style={{ backgroundColor: color.hex }} />
            <div className="p-2 flex justify-between items-center">
              <div>
                <p className="text-xs font-bold uppercase truncate">{color.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{color.hex}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive opacity-60 hover:opacity-100" onClick={() => deleteColor.mutate({ fitId: selectedFitId, colorId: color.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetColorsQueryKey(selectedFitId) }) })}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
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
    if (fits && fits.length > 0 && !selectedFitId) {
      setSelectedFitId(fits[0].id);
    }
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

  const openAdd = () => {
    setEditingSizeId(null);
    setForm({ name: "", realWidth: 0, realHeight: 0, image: "" });
    setIsOpen(true);
  };

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
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) });
          toast({ title: "Size updated" });
          setIsOpen(false);
        }
      });
    } else {
      addSize.mutate({ fitId: selectedFitId, data: form }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) });
          toast({ title: "Size added" });
          setIsOpen(false);
        }
      });
    }
  };

  const getFitLabel = (fitId: string) => {
    const fit = fits?.find(f => f.id === fitId);
    const product = products?.find(p => p.id === fit?.productId);
    return fit ? `${product?.name ?? ""} — ${fit.name}` : fitId;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {fits?.map(fit => (
          <Button key={fit.id} variant={selectedFitId === fit.id ? "default" : "outline"} className="rounded-none uppercase tracking-widest text-xs h-8" onClick={() => setSelectedFitId(fit.id)}>
            {getFitLabel(fit.id)}
          </Button>
        ))}
      </div>

      {selectedFitId && (
        <div className="flex justify-end">
          <Button onClick={openAdd} className="rounded-none uppercase tracking-widest text-xs">
            <Plus className="w-4 h-4 mr-2" /> Add Size
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {sizes?.map(size => (
          <Card key={size.id} className="rounded-none border-border">
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-black text-2xl uppercase">{size.name}</h3>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(size)}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteSize.mutate({ fitId: selectedFitId, sizeId: size.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) }) })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs font-mono text-muted-foreground mb-3">{size.realWidth}W × {size.realHeight}H cm</p>
              <div className="w-full h-32 bg-muted/10 border border-border flex items-center justify-center overflow-hidden">
                {size.image ? (
                  <img src={size.image} alt={size.name} className="object-contain h-full w-full" />
                ) : (
                  <span className="text-xs text-muted-foreground uppercase tracking-widest">No Image</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {selectedFitId && !sizes?.length && (
          <p className="text-xs text-muted-foreground uppercase tracking-widest">No sizes yet</p>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="rounded-none border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-tighter font-black">{editingSizeId ? "Edit Size" : "Add Size"}</DialogTitle>
          </DialogHeader>
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
