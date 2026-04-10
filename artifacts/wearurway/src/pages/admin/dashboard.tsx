import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { 
  useGetAdminMe,
  useGetProducts, useUpdateProduct, getGetProductsQueryKey,
  useGetFits, useUpdateFit, getGetFitsQueryKey,
  useGetColors, useAddColor, useDeleteColor, getGetColorsQueryKey,
  useGetSizes, useAddSize, useUpdateSize, useDeleteSize, getGetSizesQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Edit } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { data: adminMe, isLoading: isAuthLoading } = useGetAdminMe();
  
  useEffect(() => {
    if (!isAuthLoading && !adminMe?.authenticated) {
      setLocation("/admin");
    }
  }, [adminMe, isAuthLoading, setLocation]);

  if (isAuthLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!adminMe?.authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen pt-24 px-6 md:px-12 max-w-7xl mx-auto pb-24">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tighter uppercase">Admin Dashboard</h1>
      </div>

      <Tabs defaultValue="products" className="w-full">
        <TabsList className="mb-8 rounded-none border-b border-border bg-transparent h-auto p-0 flex space-x-6 overflow-x-auto justify-start">
          <TabsTrigger value="products" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent py-3 uppercase tracking-widest text-xs">Products</TabsTrigger>
          <TabsTrigger value="fits" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent py-3 uppercase tracking-widest text-xs">Fits</TabsTrigger>
          <TabsTrigger value="colors" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent py-3 uppercase tracking-widest text-xs">Colors</TabsTrigger>
          <TabsTrigger value="sizes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent py-3 uppercase tracking-widest text-xs">Sizes</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <ProductsManager />
        </TabsContent>
        <TabsContent value="fits">
          <FitsManager />
        </TabsContent>
        <TabsContent value="colors">
          <ColorsManager />
        </TabsContent>
        <TabsContent value="sizes">
          <SizesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProductsManager() {
  const { data: products } = useGetProducts();
  const updateProduct = useUpdateProduct();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleToggle = (id: string, field: "available" | "comingSoon", value: boolean) => {
    updateProduct.mutate({ id, data: { [field]: value } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
        toast({ title: "Product updated", description: "Changes saved successfully." });
      }
    });
  };

  return (
    <div className="grid gap-6">
      {products?.map(product => (
        <Card key={product.id} className="rounded-none border-border">
          <CardHeader>
            <CardTitle className="uppercase tracking-tight">{product.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-8">
            <div className="flex items-center space-x-2">
              <Switch 
                id={`avail-${product.id}`} 
                checked={product.available}
                onCheckedChange={(c) => handleToggle(product.id, "available", c)}
              />
              <Label htmlFor={`avail-${product.id}`}>Available</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch 
                id={`soon-${product.id}`} 
                checked={product.comingSoon}
                onCheckedChange={(c) => handleToggle(product.id, "comingSoon", c)}
              />
              <Label htmlFor={`soon-${product.id}`}>Coming Soon</Label>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FitsManager() {
  const { data: fits } = useGetFits();
  const { data: products } = useGetProducts();
  const updateFit = useUpdateFit();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleToggle = (id: string, field: "available" | "comingSoon", value: boolean) => {
    updateFit.mutate({ id, data: { [field]: value } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFitsQueryKey() });
        toast({ title: "Fit updated", description: "Changes saved successfully." });
      }
    });
  };

  return (
    <div className="grid gap-6">
      {fits?.map(fit => {
        const product = products?.find(p => p.id === fit.productId);
        return (
          <Card key={fit.id} className="rounded-none border-border">
            <CardHeader>
              <CardTitle className="uppercase tracking-tight">{fit.name}</CardTitle>
              <CardDescription>Product: {product?.name}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-8">
              <div className="flex items-center space-x-2">
                <Switch 
                  id={`f-avail-${fit.id}`} 
                  checked={fit.available}
                  onCheckedChange={(c) => handleToggle(fit.id, "available", c)}
                />
                <Label htmlFor={`f-avail-${fit.id}`}>Available</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch 
                  id={`f-soon-${fit.id}`} 
                  checked={fit.comingSoon}
                  onCheckedChange={(c) => handleToggle(fit.id, "comingSoon", c)}
                />
                <Label htmlFor={`f-soon-${fit.id}`}>Coming Soon</Label>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ColorsManager() {
  const { data: fits } = useGetFits();
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
  const [newColorHex, setNewColorHex] = useState("#000000");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColorName || !newColorHex) return;

    addColor.mutate({ fitId: selectedFitId, data: { name: newColorName, hex: newColorHex } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetColorsQueryKey(selectedFitId) });
        setNewColorName("");
        setNewColorHex("#000000");
        toast({ title: "Color added" });
      }
    });
  };

  const handleDelete = (colorId: string) => {
    deleteColor.mutate({ fitId: selectedFitId, colorId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetColorsQueryKey(selectedFitId) });
        toast({ title: "Color deleted" });
      }
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex gap-4 overflow-x-auto pb-4">
        {fits?.map(fit => (
          <Button 
            key={fit.id}
            variant={selectedFitId === fit.id ? "default" : "outline"}
            className="rounded-none uppercase tracking-widest text-xs whitespace-nowrap"
            onClick={() => setSelectedFitId(fit.id)}
          >
            {fit.name}
          </Button>
        ))}
      </div>

      {selectedFitId && (
        <Card className="rounded-none border-border">
          <CardHeader>
            <CardTitle className="uppercase tracking-tight">Add Color</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="flex gap-4 items-end">
              <div className="space-y-2 flex-1">
                <Label htmlFor="colorName">Name</Label>
                <Input 
                  id="colorName" 
                  value={newColorName}
                  onChange={e => setNewColorName(e.target.value)}
                  placeholder="e.g. Vintage Black"
                  className="rounded-none"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="colorHex">Hex</Label>
                <div className="flex gap-2">
                  <Input 
                    type="color" 
                    id="colorHex" 
                    value={newColorHex}
                    onChange={e => setNewColorHex(e.target.value)}
                    className="w-12 p-1 rounded-none h-10"
                  />
                  <Input 
                    type="text" 
                    value={newColorHex}
                    onChange={e => setNewColorHex(e.target.value)}
                    className="w-24 rounded-none h-10 uppercase"
                    placeholder="#000000"
                  />
                </div>
              </div>
              <Button type="submit" className="rounded-none h-10" disabled={addColor.isPending}>Add</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {colors?.map(color => (
          <div key={color.id} className="border border-border p-4 flex flex-col gap-4">
            <div className="w-full aspect-square border border-border" style={{ backgroundColor: color.hex }} />
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium uppercase truncate" title={color.name}>{color.name}</span>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(color.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function SizesManager() {
  const { data: fits } = useGetFits();
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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    realWidth: 0,
    realHeight: 0,
    image: ""
  });

  const openAdd = () => {
    setEditingSizeId(null);
    setFormData({ name: "", realWidth: 0, realHeight: 0, image: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (size: any) => {
    setEditingSizeId(size.id);
    setFormData({ 
      name: size.name, 
      realWidth: size.realWidth, 
      realHeight: size.realHeight, 
      image: size.image || "" 
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    if (editingSizeId) {
      updateSize.mutate({ id: editingSizeId, data: formData }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) });
          toast({ title: "Size updated" });
          setIsDialogOpen(false);
        }
      });
    } else {
      addSize.mutate({ fitId: selectedFitId, data: formData }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) });
          toast({ title: "Size added" });
          setIsDialogOpen(false);
        }
      });
    }
  };

  const handleDelete = (sizeId: string) => {
    deleteSize.mutate({ id: sizeId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSizesQueryKey(selectedFitId) });
        toast({ title: "Size deleted" });
      }
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex gap-4 overflow-x-auto pb-4">
        {fits?.map(fit => (
          <Button 
            key={fit.id}
            variant={selectedFitId === fit.id ? "default" : "outline"}
            className="rounded-none uppercase tracking-widest text-xs whitespace-nowrap"
            onClick={() => setSelectedFitId(fit.id)}
          >
            {fit.name}
          </Button>
        ))}
      </div>

      <div className="flex justify-end">
        {selectedFitId && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openAdd} className="rounded-none uppercase tracking-widest">
                <Plus className="w-4 h-4 mr-2" /> Add Size
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none border-border">
              <DialogHeader>
                <DialogTitle className="uppercase tracking-tight">{editingSizeId ? "Edit Size" : "Add Size"}</DialogTitle>
                <DialogDescription>Enter size dimensions and image path.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                    placeholder="e.g. Small"
                    className="rounded-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Width (cm)</Label>
                    <Input 
                      type="number" 
                      value={formData.realWidth} 
                      onChange={e => setFormData({...formData, realWidth: Number(e.target.value)})} 
                      className="rounded-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Height (cm)</Label>
                    <Input 
                      type="number" 
                      value={formData.realHeight} 
                      onChange={e => setFormData({...formData, realHeight: Number(e.target.value)})} 
                      className="rounded-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Image Path</Label>
                  <Input 
                    value={formData.image} 
                    onChange={e => setFormData({...formData, image: e.target.value})} 
                    placeholder="/size-images/example.png"
                    className="rounded-none"
                  />
                </div>
                <Button type="submit" className="w-full rounded-none uppercase mt-4">
                  {editingSizeId ? "Save Changes" : "Add Size"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {sizes?.map(size => (
          <Card key={size.id} className="rounded-none border-border">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <CardTitle className="uppercase tracking-tight text-2xl">{size.name}</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(size)} className="h-8 w-8">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(size.id)} className="h-8 w-8 text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-mono text-muted-foreground mb-4">
                {size.realWidth}W × {size.realHeight}H cm
              </div>
              <div className="w-full h-32 bg-muted/20 flex items-center justify-center overflow-hidden">
                {size.image ? (
                  <img src={size.image} alt={size.name} className="object-contain h-full" />
                ) : (
                  <span className="text-xs text-muted-foreground uppercase tracking-widest">No Image</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
