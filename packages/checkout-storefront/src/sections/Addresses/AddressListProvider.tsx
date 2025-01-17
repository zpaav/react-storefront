import React, { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSafeContext } from "@/checkout-storefront/providers/createSafeContext";
import { getById, getByUnmatchingId } from "@/checkout-storefront/lib/utils";
import {
  AddressFragment,
  useUserAddressCreateMutation,
  useUserAddressDeleteMutation,
  useUserAddressUpdateMutation,
  useUserQuery,
} from "@/checkout-storefront/graphql";
import { useAuthState } from "@saleor/sdk";
import {
  Address,
  AddressFormData,
  UserAddressFormData,
} from "@/checkout-storefront/sections/Addresses/types";
import { extractMutationErrors } from "@/checkout-storefront/lib/utils";
import {
  getAddressInputData,
  getUserAddressFormDataFromAddress,
  isMatchingAddress,
} from "@/checkout-storefront/sections/Addresses/utils";
import { ApiErrors, useAlerts } from "@/checkout-storefront/hooks";
import { debounce } from "lodash-es";
import { useAddressAvailability } from "@/checkout-storefront/sections/Addresses/useAddressAvailability";

interface AddressListProviderProps {
  onCheckoutAddressUpdate: (address: UserAddressFormData) => void;
  defaultAddress: Address;
  checkAddressAvailability: boolean;
}

type SubmitReturnWithErrors = Promise<{
  hasErrors: boolean;
  errors: ApiErrors<AddressFormData>;
}>;

interface ContextConsumerProps {
  addressList: AddressFragment[];
  selectedAddressId: string | undefined;
  setSelectedAddressId: (id: string) => void;
  addressUpdate: (formData: UserAddressFormData) => SubmitReturnWithErrors;
  addressCreate: (formData: AddressFormData) => SubmitReturnWithErrors;
  addressDelete: (id: string) => SubmitReturnWithErrors;
  updating: boolean;
  deleting: boolean;
  creating: boolean;
}

export const [useAddressList, Provider] = createSafeContext<ContextConsumerProps>();

export const AddressListProvider: React.FC<PropsWithChildren<AddressListProviderProps>> = ({
  children,
  onCheckoutAddressUpdate,
  defaultAddress,
  checkAddressAvailability,
}) => {
  const { user: authUser } = useAuthState();
  const [{ data }] = useUserQuery({
    pause: !authUser?.id,
  });

  const { isAvailable } = useAddressAvailability({ pause: !checkAddressAvailability });

  const { showErrors } = useAlerts();

  const user = data?.me;
  const addresses = user?.addresses || [];

  const [{ fetching: updating }, userAddressUpdate] = useUserAddressUpdateMutation();
  const [{ fetching: deleting }, userAddressDelete] = useUserAddressDeleteMutation();
  const [{ fetching: creating }, userAddressCreate] = useUserAddressCreateMutation();

  const [addressList, setAddressList] = useState(addresses);
  const [selectedAddressId, setSelectedAddressId] = useState<string | undefined>(
    defaultAddress?.id
  );

  const defaultAddressRef = useRef<Address>(null);

  const handleCheckoutAddressUpdate = (address: AddressFragment) =>
    onCheckoutAddressUpdate(getUserAddressFormDataFromAddress(address));

  const getSelectedAddress = (id: string | undefined = selectedAddressId) =>
    addressList.find(getById(id));

  const addressUpdate = async (formData: UserAddressFormData) => {
    const result = await userAddressUpdate({
      address: getAddressInputData({
        ...formData,
      }),
      id: formData.id,
    });

    const [hasErrors, errors] = extractMutationErrors(result);

    if (hasErrors) {
      showErrors(errors, "userAddressUpdate");
      return { hasErrors, errors };
    }

    const updatedAddress = result?.data?.accountAddressUpdate?.address as AddressFragment;

    const updatedList = addressList.map((existingAddress) =>
      existingAddress.id === updatedAddress.id ? updatedAddress : existingAddress
    );

    setAddressList(updatedList);

    if (isAvailable(updatedAddress)) {
      setSelectedAddressId(updatedAddress.id);

      handleCheckoutAddressUpdate(updatedAddress);
    }

    return { hasErrors: false, errors: [] };
  };

  const addressDelete = async (id: string) => {
    const result = await userAddressDelete({
      id,
    });

    const [hasErrors, errors] = extractMutationErrors(result);

    if (hasErrors) {
      showErrors(errors, "userAddressDelete");
    }

    setAddressList(addressList.filter(getByUnmatchingId(id)));

    if (selectedAddressId === id && addressList[0]) {
      const newAddress = addressList[0];
      setSelectedAddressId(newAddress.id);
      handleCheckoutAddressUpdate(newAddress);
    }

    return { hasErrors, errors };
  };

  const addressCreate = async (formData: AddressFormData) => {
    const result = await userAddressCreate({
      address: getAddressInputData({
        ...formData,
      }),
    });

    const [hasErrors, errors] = extractMutationErrors(result);

    if (hasErrors) {
      showErrors(errors, "userAddressCreate");
    } else {
      const address = result?.data?.accountAddressCreate?.address as AddressFragment;

      setAddressList([...addressList, address]);

      if (isAvailable(address)) {
        setSelectedAddressId(address.id);
        handleCheckoutAddressUpdate(address);
      }
    }

    return { hasErrors, errors };
  };

  const handleDefaultAddressSet = () => {
    if (!selectedAddressId && addressList.length) {
      setSelectedAddressId(addressList?.[0]?.id);
      return;
    }

    if (
      (getSelectedAddress() && isMatchingAddress(defaultAddress, getSelectedAddress())) ||
      defaultAddress === defaultAddressRef.current
    ) {
      return;
    }

    const matchingAddress = addressList.find((address) =>
      isMatchingAddress(defaultAddress, address)
    );

    defaultAddressRef.current = defaultAddress;
    setSelectedAddressId(matchingAddress?.id as string);
  };

  useEffect(handleDefaultAddressSet, [defaultAddress, addressList]);

  const debouncedUpdate = useCallback(
    debounce((address: AddressFragment) => {
      handleCheckoutAddressUpdate(address);
    }, 2000),
    []
  );

  const handleAddressSelect = (addressId: string) => {
    setSelectedAddressId(addressId);
    debouncedUpdate(getSelectedAddress(addressId) as AddressFragment);
  };

  const providerValues: ContextConsumerProps = useMemo(() => {
    return {
      addressList,
      setSelectedAddressId: handleAddressSelect,
      selectedAddressId,
      addressCreate,
      addressUpdate,
      addressDelete,
      deleting,
      updating,
      creating,
    };
  }, [addressList, deleting, updating, creating, selectedAddressId]);

  return <Provider value={providerValues}>{children}</Provider>;
};
